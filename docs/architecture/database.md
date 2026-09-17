# Database

`src/infrastructure/database`: multi-source connection layer. Oracle (node-oracledb 6) is implemented; `postgres`, `mysql`, `mariadb`, `mssql` and `sqlite` are placeholders you can implement later.

## Components

| Component                     | File                                               | Role                                                                                                          |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Source config                 | `infrastructure/config/schemas/database.schema.ts` | validates `DATABASE_CONFIG_JSON` (per-dialect fields, defaults, secret references)                            |
| `PoolManager`                 | `connection/pool.manager.ts`                       | one client per source; `withConnection`, `transaction`, `ping`, `pingAll`, `health`; closes pools on shutdown |
| `ConnectionProvider` factory  | `connection/connection.provider.ts`                | reads config, `init()`s pools, runs boot pings; bound to `ConnectionProviderToken`                            |
| `ConnectionProvider` contract | `contracts/connection-provider.ts`                 | the interface DAOs and repositories depend on                                                                 |
| `DatabaseClient`              | `clients/database-client.interface.ts`             | per-dialect client contract                                                                                   |
| `OracleClient`                | `clients/oracle.client.ts`                         | pool borrowing, context user, timeouts, execute defaults, slow-query log, error mapping                       |
| Oracle helpers                | `clients/oracle/*`                                 | driver init (thick mode, `fetchAsString`), pool attribute mapping, error mapper                               |
| `NotImplementedClient`        | `clients/not-implemented.client.ts`                | placeholder; throws `UnsupportedDialectError` (501)                                                           |
| Source keys                   | `sources.ts`                                       | `DatabaseSources.main`: keys DAOs use (must match config `key`)                                               |
| Example query DAO             | `queries/database-info-query.dao.ts`               | implements `DatabaseInfoQueryPort`                                                                            |

## Using it from a DAO or repository

```ts
constructor(private readonly db: ConnectionProvider) {}

findById(id: string, options?: RepositoryOptions) {
    return this.db.withConnection<Ticket | undefined, Connection>(
        DatabaseSources.main,
        async (connection) => {
            const { rows } = await connection.execute<TicketRow>(
                'SELECT id, title FROM tickets WHERE id = :id',
                { id },                                   // always bind, never interpolate values
                { outFormat: oracledb.OUT_FORMAT_OBJECT }, // named columns
            );
            return rows?.[0] ? TicketMapper.toDomain(rows[0]) : undefined;
        },
        { contextUser: options?.actor, tag: 'tickets.findById' },
    );
}
```

`ConnectionOptions`:

| Option          | Effect                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| `contextUser`   | end user sent as Oracle `CLIENT_IDENTIFIER` for this call              |
| `callTimeoutMs` | per round-trip timeout override (default: source `callTimeoutMs`)      |
| `tag`           | label for logs and errors, e.g. `tickets.findById`. Never put SQL here |
| `username`      | deprecated alias of `contextUser` (atoll compatibility)                |

`transaction(sourceKey, fn, options)` works the same on a single connection: commit if `fn` resolves, rollback if it throws.

`connection.execute` inside `withConnection` is wrapped to apply the source's fetch defaults (`fetchArraySize`, `prefetchRows`, `maxRows`, `outFormat`); options you pass override them. Queries slower than `slowQueryMs` log `db.query.slow`, including the SQL only when `logSql` is on. Bind values are never logged.

## Where database code goes

| Your service…                                                         | Model and port                                        | Adapter    |
| --------------------------------------------------------------------- | ----------------------------------------------------- | ---------- |
| only reads                                                            | read model + query port (`application/ports/queries`) | query DAO  |
| changes data, rules in your code                                      | aggregate + repository port (`domain/repositories`)   | repository |
| changes data through another team's procedures that enforce the rules | gateway port (`application/ports/gateways`)           | gateway    |

Table and cursor columns are row types in `infrastructure/database/mappers` in every case. Who owns the schema doesn't change this; when another team does, follow [Work with a database you don't own](../guides/work-with-a-database-you-dont-own.md).

## Unit of work

`UnitOfWorkPort` (application) is implemented by `DatabaseUnitOfWork` over `ConnectionProvider.runInTransaction('main', work)`. `PoolManager` keeps the transaction's connection in `AsyncLocalStorage` for the duration of `work`; any `withConnection`/`transaction` call for that source in the same async flow reuses it instead of borrowing a connection, and nested units join the outer one. Commit/rollback happens once, in the outer call. Usage: [Add a repository › Multiple aggregates](../guides/add-repository.md#multiple-aggregates-in-one-transaction).

## Context user lifecycle

When `contextUser` is set (and the source's `contextUser.enabled` is true):

1. Borrow a connection; set `connection.clientId = user` (sent with the first round trip; no extra `DBMS_SESSION` call).
2. Run `fn`. Oracle sees the user in `SYS_CONTEXT('USERENV','CLIENT_IDENTIFIER')`, `V$SESSION.CLIENT_IDENTIFIER`, unified audit, and VPD policies.
3. In `finally`: `clientId = ''`, then `ping()` so the clear actually reaches the server.
4. If that ping fails, release with `{ drop: true }`: the connection leaves the pool, so the next borrower can never inherit the identity.

Per-source settings:

- `contextUser.required: true` rejects calls without a user with `UnauthorizedError` (before borrowing).
- `contextUser.maxLength` truncates to that many **bytes** (Oracle limit 64).

Cost: one extra round trip (the clearing ping) per call that sets a user. Calls without a user pay nothing.

## Error mapping

`OracleClient` maps driver errors once (`clients/oracle/oracle-error.mapper.ts`):

| Driver code                                                                                                                                         | Error                                             | HTTP |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---- |
| `ORA-00001` (unique constraint)                                                                                                                     | `ConflictError`                                   | 409  |
| `NJS-040`/`NJS-076` (pool queue timeout/full), `NJS-500..521`, `DPI-1010`, `DPI-1080`, `ORA-03113/03114/03135`, `ORA-12170/12514/12541/12543/12545` | `DatabaseConnectionError`                         | 503  |
| any other `ORA-`/`NJS-`                                                                                                                             | `DatabaseExecutionError` (keeps `code`, `sqlTag`) | 500  |
| failure acquiring a connection                                                                                                                      | `DatabaseConnectionError`                         | 503  |

Clients never see ORA codes or messages; logs do. To map an application-raised error (`RAISE_APPLICATION_ERROR -20101`) to a business error, catch `DatabaseExecutionError` with that `code` in the adapter and return or throw an application error.

## Boot and health

- On startup the `ConnectionProvider` factory creates the pools, then, if `DATABASE_PING_ON_BOOT`, pings every implemented source. Pings use concurrency, jitter, retries with exponential backoff, and a per-ping `callTimeout`.
- If a **required** source (`DATABASE_PING_REQUIRED_SOURCES`, default: all implemented) fails, boot aborts with `AggregateDbHealthError`. Optional sources only warn.
- Placeholder dialects are skipped with a warning, or fail boot if listed as required.
- `health(timeoutMs)` (non-throwing, per source, including pool stats) powers `GET /health/ready`.
- With `DATABASE_CONFIG_JSON` unset, no pools are created and readiness reports `sources: []`.

## Shutdown

`app.enableShutdownHooks()` → `PoolManager.onModuleDestroy()` → `pool.close(drainTimeSec)` for every source, in parallel. In-flight calls get `drainTimeSec` to finish.

## Configuration

Every field and default: [Configuration → Database](configuration.md#database).

Tuning notes:

- `poolMin` = steady concurrency, `poolMax` ≤ what the DB allows for this app. Keep `poolIncrement` small.
- `queueTimeoutMs`: how long a request waits for a free connection before 503. Keep it below your HTTP timeout.
- `callTimeoutMs`: cap for one round trip; prevents a hung query from pinning a connection.
- `expireTimeMin` (e.g. 5): keepalive probes that detect connections silently dropped by firewalls.
- `stmtCacheSize`: ≥ the number of distinct hot statements.
- `enableStatistics`: adds detailed pool stats to `/health/ready`.
- Thick mode (`ORACLE_THICK_MODE=true`, `ORACLE_CLIENT_LIB_DIR`) is needed only for features thin mode lacks (e.g. some Advanced Security options, older DB versions).

## Related

- [Add a repository](../guides/add-repository.md)
- [Add a query port and DAO](../guides/add-query-port-and-dao.md)
- [Add a database source](../guides/add-database-source.md)
- [Implement a database dialect](../guides/add-database-dialect.md)
- [Decision 0003: Oracle context user](../decisions/0003-oracle-context-user.md)
