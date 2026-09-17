# Nestjs Domain Driven Design

NestJS 11 starter template for layered / DDD HTTP services: consistent response envelope, structured logging, fail-fast config, multi-source database layer (Oracle implemented), JWT verification, and enforced layer boundaries.

## 1. Highlights

- Layered architecture (Interface → Application → Domain, Infrastructure behind ports), **enforced by ESLint** and checked for cycles with `madge`.
- Multi-source database layer configured by JSON: Oracle (node-oracledb, thin or thick) fully implemented; postgres/mysql/mariadb/mssql/sqlite placeholders ready to implement.
- Per-source Oracle pool/driver tuning, boot ping with retries, readiness probe, graceful pool drain on shutdown.
- **Context user per query**: the end user is set as Oracle `CLIENT_IDENTIFIER` for one call and cleared before the connection returns to the pool.
- Request-correlated structured logging (`nestjs-pino`), daily file rotation, secrets redacted, 5xx always logged.
- Fail-fast config (`dotenv-flow` + Zod); errors never print values.
- Response envelope `{ success, data | error, meta }`; `Result` errors mapped to real HTTP status.
- Zod request validation (Express 5 safe), Swagger (off in production by default), helmet, CORS allow-list, rate limiting.

## 2. Tech Stack

Node.js ≥ 22.18 · NestJS 11 (Express 5) · TypeScript 5 · `oracledb` 6 · `nestjs-pino`/`pino-roll` · `zod` 4 · `passport-jwt` · `@nestjs/swagger` · `@nestjs/throttler` · `helmet` · Jest 30 · pnpm 10

## 3. Repository Layout

```text
src/
├── main.ts / app.module.ts        # bootstrap + composition root
├── domain/                        # pure business rules (no Nest, no infra)
│   ├── base/                      # Entity, ValueObject, AggregateRoot
│   ├── errors/                    # DomainError, ValidationError, AggregateNotFoundError
│   └── auth/                      # JWTPayload
├── application/                   # use cases + ports (interfaces + DI tokens)
│   ├── ports/                     # ConfigPort, LoggerPort, repository ports, tokens.ts
│   ├── use-cases/
│   └── errors/                    # AppError subclasses (→ HTTP status via problem kind)
├── infrastructure/                # adapters implementing ports
│   ├── config/                    # env → Zod schemas → ConfigPort
│   ├── logging/                   # pino
│   ├── auth/                      # JWT strategy
│   └── database/
│       ├── clients/               # OracleClient, NotImplementedClient, oracle/ helpers
│       ├── connection/            # PoolManager, ConnectionProvider (boot ping)
│       ├── dao/                   # port implementations (example: DatabaseInfoDao)
│       ├── errors/ utils/ types/
│       └── sources.ts             # source keys used by DAOs
├── interface/http/                # controllers, guards, interceptors, filter, swagger
├── common/                        # framework helpers (ProviderFactory, UseCase base, utils)
└── shared/                        # framework-free primitives (Result, Problem, envelope, pagination)
test/
├── unit/                          # mirrors src/
├── e2e/                           # boots AppModule (no DB)
└── fixtures/
```

## 4. Architecture Rules

| Layer | May import | Must not import |
| --- | --- | --- |
| `domain` | `@shared`, itself | `@application`, `@infrastructure`, `@interface`, `@nestjs/*` |
| `application` | `@domain`, `@common`, `@shared`, `@nestjs/common` (DI) | `@infrastructure`, `@interface`, drivers (`oracledb`…), `express` |
| `infrastructure` | `@application/ports`, `@domain`, `@common`, `@shared` | `@interface` |
| `interface` | `@application`, `@domain`, `@shared`, infra **tokens/contracts** only | adapters' internals |

- DI tokens live next to ports in `application/ports/tokens.ts`.
- `AppModule` is the only place that imports all layer modules. `ApplicationModule` and `InterfaceModule` never import `InfrastructureModule` (infra modules are `@Global`).
- Rules are enforced with `no-restricted-imports` in `eslint.config.mjs`; cycles with `pnpm check:circular`.

### Use-case convention

- Expected business failure → `return this.err(new SomeAppError(...))`. The response formatter rethrows it and the exception filter maps its problem `kind` to the HTTP status (404, 409, 422…).
- A non-`AppError` value in `Result.err` (e.g. `'database_error'`) → **422** with `code`.
- Unexpected failure → `throw`.
- Map DB rows to types **in the DAO** (prefer `outFormat: OBJECT` + named columns), never positional indexes in domain code.

### Guards

Guards run **before** pipes/interceptors, so request data read in a guard is unvalidated. Use `readGuardInput(context, 'params', schema)` and throw `ForbiddenError`/`UnauthorizedError` rather than returning `false`.

### Validation

`@UseZodHttp({ body, query, params, headers })` validates and stores results on `req.validated`; read them with `@Validated('query')`. `body`/`params` are also replaced in place. `req.query` is **not** assigned: it is a read-only getter in Express 5.

## 5. Database Layer

```ts
// DAO (infrastructure) — depends on the ConnectionProvider contract
this.db.withConnection<Row[], Connection>(
    DatabaseSources.main,
    async (conn) => (await conn.execute<Row>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT })).rows ?? [],
    { contextUser: username, tag: 'orders.findByUser', callTimeoutMs: 5000 },
);

this.db.transaction(DatabaseSources.main, async (conn) => { /* commit on success, rollback on throw */ }, { contextUser });
```

### Context user (Oracle `CLIENT_IDENTIFIER`)

Per call, when `contextUser` is passed:

1. `connection.clientId = user`: sent with the first round trip (no extra `DBMS_SESSION` call).
2. Your queries run. The database sees it in `SYS_CONTEXT('USERENV','CLIENT_IDENTIFIER')`, `V$SESSION.CLIENT_IDENTIFIER`, and audit/VPD policies.
3. Before release: `clientId = ''` + `ping()` flushes the clear. If that fails, the connection is **dropped** from the pool, so an identity never leaks to the next borrower.

Per-source switches: `contextUser.enabled` (default `true`), `contextUser.required` (reject calls without a user), `contextUser.maxLength` (bytes, ≤ 64). `ConnectionOptions.username` is kept as a deprecated alias.

### Errors

Driver errors are mapped once in `OracleClient`: `ORA-00001` → `ConflictError` (409); pool/network (`NJS-040`, `NJS-500`, `ORA-03113`, `ORA-12170`, …) → `DatabaseConnectionError` (503); everything else → `DatabaseExecutionError` (500) with the ORA code kept for logs. Clients never see ORA codes or messages.

### Adding a dialect

Implement `DatabaseClient` (`withConnection`, `transaction`, `ping`, `close`, `stats`, `implemented = true`) and replace the placeholder branch in `PoolManager.init`. Placeholders are skipped by boot pings unless listed in `DATABASE_PING_REQUIRED_SOURCES` (then boot fails).

### Health

- `GET /health`: liveness.
- `GET /health/ready`: pings every implemented source. Returns 503 when one fails. Error text is hidden in production.

## 6. Cross-cutting Behaviour

- **Bootstrap** (`main.ts`): buffered pino logger → shutdown hooks → helmet, cookies → server timeouts → body parsers with limits → CORS allow-list → URI versioning (`v1` default; `/health` version-neutral) → Swagger (if enabled). Invalid config prints the failing paths (no values) and exits 1.
- **Logging**: `LoggerPort` adapter is a singleton; nestjs-pino binds the request logger via AsyncLocalStorage, so logs keep the request id without request-scoped DI. 5xx are always logged; stacks only with `SHOW_STACK_TRACES=true`. Authorization/cookie headers are removed from logs.
- **Errors**: `GlobalExceptionFilter` handles `HttpException`, body-parser errors (413/400), and `AppError`/`DomainError` via `ErrorPresenter`. Internal `details` are never returned.
- **Security**: CORS disabled unless `CORS_ORIGINS` is set (cookies + reflected origins would allow cross-site calls); helmet headers; global throttling (`THROTTLE_*`, `/health` exempt); JWT from cookie or `Authorization: Bearer`, with algorithm/issuer/audience checks. For cookie auth on state-changing routes, also use `SameSite=strict` cookies or add an origin/CSRF check.

## 7. Configuration

See `.env.example` for every variable. Unset or blank values use the defaults below.

### 7.1 Application, logging, HTTP, JWT

| Variable | Default | Notes |
| --- | --- | --- |
| `NODE_ENV` | _required_ | `development` \| `test` \| `staging` \| `production` |
| `LOG_LEVEL` | `info` | |
| `SHOW_STACK_TRACES` | `false` | |
| `REQUEST_ID_HEADER` | `x-request-id` | |
| `LOGGING_TO_FILE` / `LOGGING_DIR` / `LOGGING_FILE_NAME` | `true` / `logs` / `app.log` | daily rotation |
| `LOGGING_FILES_LIMIT` / `LOGGING_MAX_SIZE` | `14` / `10m` | |
| `LOGGING_PRETTY` | dev only | falls back to JSON if `pino-pretty` isn't installed |
| `PORT` | `3000` | |
| `CORS_ORIGINS` | _(empty = disabled)_ | comma-separated |
| `SERVER_TIMEOUT` / `HEADERS_TIMEOUT` / `KEEP_ALIVE_TIMEOUT` | `120000` / `121000` / `61000` | ms |
| `JSON_BODY_LIMIT` / `URLENCODED_BODY_LIMIT` | `1mb` | |
| `SWAGGER_ENABLED` | off in production | served at `/docs` |
| `THROTTLE_TTL_MS` / `THROTTLE_LIMIT` | `60000` / `100` | `0` disables |
| `TRUST_PROXY` | `false` | |
| `JWT_SECRET` | _required_ | ≥ 32 chars |
| `JWT_ALGORITHMS` / `JWT_ISSUER` / `JWT_AUDIENCE` / `JWT_COOKIE_NAME` | `HS256` / – / – / `jwt` | |

### 7.2 Database

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_CONFIG_JSON` | _(unset = no DB)_ | JSON array of sources (wrap in single quotes) |
| `DATABASE_PING_ON_BOOT` | `true` | |
| `DATABASE_PING_TIMEOUT_MS` / `_MAX_RETRIES` / `_CONCURRENCY` / `_JITTER_MS` | `3000` / `2` / `3` / `250` | |
| `DATABASE_PING_REQUIRED_SOURCES` | all implemented | comma-separated keys; others only warn |
| `DATABASE_USE_DBLINK` | `false` | |
| `ORACLE_THICK_MODE` | `false` | thin needs no Instant Client |
| `ORACLE_CLIENT_LIB_DIR` / `ORACLE_CLIENT_CONFIG_DIR` | – | thick mode |
| `ORACLE_FETCH_AS_STRING` / `ORACLE_FETCH_AS_BUFFER` | – | e.g. `CLOB,NUMBER` / `BLOB` |

**Oracle source fields** (inside `DATABASE_CONFIG_JSON`):

| Group | Field (default) |
| --- | --- |
| Target / auth | `key`, `connectionUrl` (`oracle://user:pass@host:1521/service`) **or** `connectString` + `user` + `password`/`passwordEnv`; `externalAuth` (false), `edition`, `configDir`, `walletLocation`, `walletPassword`/`walletPasswordEnv`, `sslServerDNMatch`, `httpsProxy`, `httpsProxyPort` |
| Pool | `poolMin` (2), `poolMax` (10), `poolIncrement` (1), `poolTimeoutSec` (60), `poolMaxLifetimeSessionSec` (0), `poolPingIntervalSec` (60), `poolPingTimeoutMs` (5000), `queueMax` (500), `queueTimeoutMs` (60000), `stmtCacheSize` (30), `enableStatistics` (false), `homogeneous` (true), `drainTimeSec` (10) |
| Network | `connectTimeoutSec` (20), `expireTimeMin` (0), `retryCount` (0), `retryDelaySec` (1), `callTimeoutMs` (0 = none) |
| Fetch | `fetchArraySize` (100), `prefetchRows` (2), `maxRows` (0), `outFormat` (`array` \| `object`) |
| Behaviour | `slowQueryMs` (1000), `logSql` (false; binds never logged), `healthQuery` (`SELECT 1 FROM DUAL`), `contextUser` (`{ enabled: true, required: false, maxLength: 64 }`) |

Example:

```dotenv
DATABASE_CONFIG_JSON='[
  {"key":"main","dialect":"oracle","connectString":"db:1521/APP","user":"app","passwordEnv":"MAIN_DB_PASSWORD",
   "poolMin":4,"poolMax":20,"queueTimeoutMs":10000,"callTimeoutMs":30000,"expireTimeMin":5,
   "contextUser":{"required":true}},
  {"key":"reports","dialect":"postgres","connectionUrl":"postgres://u:p@pg:5432/reports"}
]'
MAIN_DB_PASSWORD=...
DATABASE_PING_REQUIRED_SOURCES=main
```

## 8. Developer Workflow

```bash
pnpm install
pnpm start:dev        # watch, NODE_ENV=development (.env.development)
pnpm build && pnpm start:prod   # set NODE_ENV in the environment for prod
pnpm start:repl

pnpm lint && pnpm lint:test
pnpm check:circular
pnpm test             # unit (test/unit)
pnpm test:cov
pnpm test:e2e         # boots AppModule without a database
```

If you add non-TS runtime files (e.g. mail templates), list them in `nest-cli.json` → `compilerOptions.assets` so they are copied to `dist`.

## 9. Extending

1. **Domain**: entities/value objects under `src/domain` (validate in static `create`, return `Result`).
2. **Port**: interface + token in `src/application/ports`.
3. **Use case**: `src/application/use-cases`, register in `ApplicationModule`.
4. **Adapter**: DAO in `src/infrastructure/database/dao`, bind the token in `DatabaseModule` with `ProviderFactory.factory(Token, (db) => new Dao(db), [ConnectionProviderToken])`.
5. **Interface**: controller + `@UseZodHttp`, pass `user.username` down as `contextUser`.
6. **Test**: unit under `test/unit/<layer>/…`, HTTP flows in `test/e2e`.
