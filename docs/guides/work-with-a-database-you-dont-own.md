# Work with a database you don't own

For services where another team owns the schema: you don't write migrations, you get table/view definitions, and actions or reads go through their **procedures and functions**.

Background: [Database](../architecture/database.md). The code below is the _Accounts_ example on the `example/tickets` branch, compiled and tested against a live Oracle (the other team's package is simulated by a stub in the test).

## 0. Get the contract from the DB team

Before writing code, get (and keep in the repo, e.g. in the adapter's constants file):

| Ask for                                                                        | Why                                                         |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Object names, owner schema, synonyms and grants for your DB user               | `account_api.suspend_account` must be callable as your user |
| Procedure/function signatures (parameter names, IN/OUT, types, cursor columns) | binds and row types                                         |
| Error codes raised with `RAISE_APPLICATION_ERROR` and what each means          | map refusals to 404/409 instead of 500                      |
| Whether procedures `COMMIT` themselves                                         | decides `transaction()` vs `withConnection()`               |
| Whether they audit `CLIENT_IDENTIFIER`                                         | the context user is set for you on every call               |
| How they announce breaking changes                                             | only the mapper/adapter should need to change               |

Don't add DDL or migrations for their objects to this repo.

## 1. Decide the shape

Ownership of the tables doesn't decide where code goes; **what your service does with the data** does:

| Your service…                                                                      | Model            | Port location                                       | Adapter                                            |
| ---------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------- | -------------------------------------------------- |
| only **reads** (lists, details, reports), from tables, views, functions or cursors | read model       | `application/ports/queries/<name>.query.port.ts`    | query DAO in `infrastructure/database/queries`     |
| **changes** data and **its own code** enforces the rules                           | domain aggregate | `domain/repositories`                               | repository ([Add a repository](add-repository.md)) |
| **changes** data through **their procedures**, which enforce the rules             | none in domain   | `application/ports/gateways/<name>.gateway.port.ts` | gateway in `infrastructure/database/gateways`      |

The **table/cursor columns** (`ACCOUNT_ID`, `STATUS_CODE`) are neither: they are a row type in `infrastructure/database/mappers`, translated into the read model your API returns.

## 2. Ports

A gateway port for actions. Expected refusals are values:

```ts
// src/application/ports/gateways/account.gateway.port.ts
import type { ConflictError, NotFoundError } from '@application/errors';
import { createToken, type Result } from '@shared';

export type SuspendAccountCommand = {
    accountId: string;
    reason: string;
};

export type SuspendAccountFailure = NotFoundError | ConflictError;

export type GatewayOptions = {
    /** Username for DB auditing (Oracle CLIENT_IDENTIFIER). */
    actor?: string;
};

/**
 * Actions another team's database performs for us (their procedures enforce the rules).
 * Expected refusals come back as failed Results; the adapter maps the procedure's error codes.
 */
export interface AccountGateway {
    suspend(
        command: SuspendAccountCommand,
        options?: GatewayOptions,
    ): Promise<Result<{ status: string }, SuspendAccountFailure>>;
}

export const AccountGatewayToken = createToken<AccountGateway>('AccountGateway');
```

A query port for reads:

```ts
// src/application/ports/queries/account.query.port.ts
import { createToken } from '@shared';
import type { QueryOptions } from './query-options';

/** Read model: what our API returns, not the other team's column layout. */
export type AccountSummary = {
    id: string;
    holder: string;
    status: 'active' | 'suspended';
    openedAt: string; // ISO-8601
};

export interface AccountQueryPort {
    listByStatus(
        status: AccountSummary['status'],
        options?: QueryOptions,
    ): Promise<AccountSummary[]>;
    /** `undefined` when the account doesn't exist. */
    getBalance(accountId: string, options?: QueryOptions): Promise<number | undefined>;
}

export const AccountQueryPortToken = createToken<AccountQueryPort>('AccountQueryPort');
```

Export both through `ports/gateways/index.ts`, `ports/queries/index.ts` and `ports/index.ts` (named exports).

## 3. Row type and mapper: isolate their schema

```ts
// src/infrastructure/database/mappers/account.mapper.ts
import type { AccountSummary } from '@application/ports';

/**
 * Columns of the DB team's `account_api.list_accounts` cursor. Their names and codes stay here:
 * if the other team renames a column or adds a status code, only this mapper changes.
 */
export type AccountRow = {
    ACCOUNT_ID: string;
    HOLDER_NAME: string;
    STATUS_CODE: 'A' | 'S';
    OPENED_ON: Date;
};

const STATUS: Record<AccountRow['STATUS_CODE'], AccountSummary['status']> = {
    A: 'active',
    S: 'suspended',
};

export const AccountMapper = {
    toSummary(row: AccountRow): AccountSummary {
        return {
            id: row.ACCOUNT_ID,
            holder: row.HOLDER_NAME,
            status: STATUS[row.STATUS_CODE],
            openedAt: row.OPENED_ON.toISOString(),
        };
    },

    toStatusCode(status: AccountSummary['status']): AccountRow['STATUS_CODE'] {
        return status === 'active' ? 'A' : 'S';
    },
};
```

Their column names and codes (`'A'`/`'S'`) never leave this file. When the DB team changes the cursor, update the row type and mapper; ports, use cases and API stay the same.

## 4. Actions: call a procedure

Keep the procedure's error codes in one constants file:

```ts
// src/infrastructure/database/gateways/account-api.constants.ts
/**
 * Contract with the DB team's `account_api` package: the codes its procedures raise with
 * RAISE_APPLICATION_ERROR. Keep this file in sync with their documentation.
 */
export const AccountApiErrorCodes = {
    accountNotFound: 'ORA-20001',
    alreadySuspended: 'ORA-20002',
} as const;
```

```ts
// src/infrastructure/database/gateways/account-api.gateway.ts
import { ConflictError, NotFoundError } from '@application/errors';
import type {
    AccountGateway,
    GatewayOptions,
    SuspendAccountCommand,
    SuspendAccountFailure,
} from '@application/ports';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { DatabaseExecutionError } from '@infrastructure/database/errors';
import { DatabaseSources } from '@infrastructure/database/sources';
import { Result } from '@shared';
import oracledb, { type Connection } from 'oracledb';
import { AccountApiErrorCodes } from './account-api.constants';

/** Named parameters (`p_x => :x`) keep working if the DB team reorders the signature. */
const SUSPEND_ACCOUNT = `
    BEGIN
        account_api.suspend_account(
            p_account_id => :accountId,
            p_reason     => :reason,
            o_status     => :status
        );
    END;`;

type SuspendOutBinds = { status: string };

/** Calls the DB team's procedures; their rules decide, this adapter only translates. */
export class AccountApiGateway implements AccountGateway {
    constructor(private readonly db: ConnectionProvider) {}

    async suspend(
        command: SuspendAccountCommand,
        options?: GatewayOptions,
    ): Promise<Result<{ status: string }, SuspendAccountFailure>> {
        try {
            // transaction(): commits our call; harmless if the procedure commits itself
            const status = await this.db.transaction<string, Connection>(
                DatabaseSources.main,
                async (connection) => {
                    const { outBinds } = await connection.execute<SuspendOutBinds>(
                        SUSPEND_ACCOUNT,
                        {
                            accountId: command.accountId,
                            reason: command.reason,
                            status: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 20 },
                        },
                    );
                    return outBinds!.status;
                },
                { contextUser: options?.actor, tag: 'accounts.suspend' },
            );
            return Result.ok({ status });
        } catch (error) {
            const failure = toSuspendFailure(error, command.accountId);
            if (failure) return Result.err(failure);
            throw error; // anything else is unexpected → 500/503
        }
    }
}

/** The procedure's documented refusals become application errors (404, 409). */
function toSuspendFailure(error: unknown, accountId: string): SuspendAccountFailure | undefined {
    if (!(error instanceof DatabaseExecutionError)) return undefined;
    switch (error.code) {
        case AccountApiErrorCodes.accountNotFound:
            return new NotFoundError(`Account ${accountId} not found`);
        case AccountApiErrorCodes.alreadySuspended:
            return new ConflictError(`Account ${accountId} is already suspended`);
        default:
            return undefined;
    }
}
```

- **Named parameters** (`p_account_id => :accountId`) survive reordered signatures.
- **OUT binds** declare `dir`, `type` and, for strings, `maxSize`; read them from `outBinds`.
- **Errors**: outside the callback, driver errors arrive mapped as `DatabaseExecutionError` with `code` (`ORA-20001`). Translate only the codes in the contract; rethrow the rest (500, or 503 for connection errors). This also works inside a unit of work.
- **Commits**: use `transaction()` for procedures that change data unless the DB team says the procedure commits itself (then `withConnection()` is enough; an extra commit is harmless).
- **Large text OUT params**: bind `type: oracledb.CLOB` and read with `lobToString` from `infrastructure/database/utils/lob-to-string.util.ts`.

## 5. Reads: cursors and functions

```ts
// src/infrastructure/database/queries/account-api-query.dao.ts
import type { AccountQueryPort, AccountSummary, QueryOptions } from '@application/ports';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { AccountMapper, type AccountRow } from '@infrastructure/database/mappers/account.mapper';
import { DatabaseSources } from '@infrastructure/database/sources';
import oracledb, { type Connection, type ResultSet } from 'oracledb';

/** Procedure with an OUT SYS_REFCURSOR: rows are read from the returned result set. */
const LIST_ACCOUNTS = `
    BEGIN
        account_api.list_accounts(p_status_code => :statusCode, o_accounts => :accounts);
    END;`;

/** Scalar function: assign its return value to an OUT bind. */
const GET_BALANCE = `
    BEGIN
        :balance := account_api.get_balance(p_account_id => :accountId);
    END;`;

const FETCH_ROWS = 100;

export class AccountApiQueryDao implements AccountQueryPort {
    constructor(private readonly db: ConnectionProvider) {}

    listByStatus(
        status: AccountSummary['status'],
        options?: QueryOptions,
    ): Promise<AccountSummary[]> {
        return this.db.withConnection<AccountSummary[], Connection>(
            DatabaseSources.main,
            async (connection) => {
                const { outBinds } = await connection.execute<{ accounts: ResultSet<AccountRow> }>(
                    LIST_ACCOUNTS,
                    {
                        statusCode: AccountMapper.toStatusCode(status),
                        accounts: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
                    },
                    // applies to the cursor's rows too
                    { outFormat: oracledb.OUT_FORMAT_OBJECT },
                );
                const cursor = outBinds!.accounts;
                const accounts: AccountSummary[] = [];
                try {
                    let rows: AccountRow[];
                    do {
                        rows = await cursor.getRows(FETCH_ROWS);
                        accounts.push(...rows.map((row) => AccountMapper.toSummary(row)));
                    } while (rows.length === FETCH_ROWS);
                } finally {
                    await cursor.close(); // always close cursors, or the session leaks open cursors
                }
                return accounts;
            },
            { contextUser: options?.actor, tag: 'accounts.listByStatus' },
        );
    }

    getBalance(accountId: string, options?: QueryOptions): Promise<number | undefined> {
        return this.db.withConnection<number | undefined, Connection>(
            DatabaseSources.main,
            async (connection) => {
                const { outBinds } = await connection.execute<{ balance: number | null }>(
                    GET_BALANCE,
                    {
                        accountId,
                        balance: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
                    },
                );
                return outBinds!.balance ?? undefined; // the function returns NULL for unknown ids
            },
            { contextUser: options?.actor, tag: 'accounts.getBalance' },
        );
    }
}
```

| Their object                       | Call                                                                             | Read the result                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| table or view                      | `SELECT ... FROM their_view WHERE ...`                                           | `rows` ([Add a query port and DAO](add-query-port-and-dao.md))          |
| procedure with `OUT SYS_REFCURSOR` | `BEGIN pkg.proc(p_x => :x, o_rows => :rows); END;`, bind `type: oracledb.CURSOR` | `outBinds.rows.getRows(n)` in a loop, **always `close()`** in `finally` |
| scalar function                    | `BEGIN :result := pkg.fn(p_x => :x); END;`                                       | `outBinds.result` (`NULL` → `undefined`)                                |
| pipelined / table function         | `SELECT ... FROM TABLE(pkg.fn(:x))`                                              | `rows`, like a view                                                     |

`outFormat: oracledb.OUT_FORMAT_OBJECT` on the call also applies to the cursor's rows.

## 6. Bind and use

```ts
// src/infrastructure/database/database.module.ts (excerpt)
ProviderFactory.factory(
    AccountGatewayToken,
    (db: IConnectionProvider) => new AccountApiGateway(db),
    [ConnectionProviderToken],
),
ProviderFactory.factory(
    AccountQueryPortToken,
    (db: IConnectionProvider) => new AccountApiQueryDao(db),
    [ConnectionProviderToken],
),
// exports: [..., AccountGatewayToken, AccountQueryPortToken]
```

The use case stays thin; the procedure owns the rules:

```ts
// src/application/use-cases/accounts/suspend-account.use-case.ts
import {
    AccountGatewayToken,
    type AccountGateway,
    type SuspendAccountFailure,
} from '@application/ports';
import { UseCase } from '@common/base';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';

type Input = { accountId: string; reason: string; username: string };
type Output = { accountId: string; status: string };

/** The DB team's procedure owns the suspension rules; the use case passes the request through. */
@Injectable()
export class SuspendAccountUseCase extends UseCase<Input, Output, SuspendAccountFailure> {
    constructor(@Inject(AccountGatewayToken) private readonly accounts: AccountGateway) {
        super();
    }

    async execute(input: Input): Promise<Result<Output, SuspendAccountFailure>> {
        const result = await this.accounts.suspend(
            { accountId: input.accountId, reason: input.reason },
            { actor: input.username },
        );
        if (!result.ok) return result; // 404 / 409 from the procedure's error codes
        return this.ok({ accountId: input.accountId, status: result.value.status });
    }
}
```

Expose it with a controller as usual ([Add a controller](add-controller.md)); `NotFoundError`/`ConflictError` become 404/409.

## 7. Test

| Level           | What                                                                                                                                                                                                 | Example                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Unit: gateway   | mocked `ConnectionProvider`: SQL uses named params, exact binds incl. OUT bind specs, each contract error code → its failure, other errors rethrown                                                  | `test/unit/infrastructure/database/gateways/account-api.gateway.spec.ts`  |
| Unit: query DAO | cursor read in batches, mapping, cursor closed even when reading fails, function `NULL` → `undefined`                                                                                                | `test/unit/infrastructure/database/queries/account-api-query.dao.spec.ts` |
| Unit: use cases | fake ports                                                                                                                                                                                           | `test/unit/application/use-cases/accounts/account.use-cases.spec.ts`      |
| Live            | real Oracle; the DB team's package is replaced by a **stub package** created in `beforeAll` and dropped in `afterAll`, implementing the documented contract (same signatures, codes, cursor columns) | `test/integration/account-api.int-spec.ts` (`pnpm test:oracle`)           |

Also run the live suite against the DB team's **real** objects in a shared test environment before releases: the stub proves your adapter matches the contract, not that their implementation does.

## Checklist

- [ ] Contract (names, params, cursor columns, error codes, commit behaviour) recorded next to the adapter
- [ ] No DDL/migrations for objects you don't own
- [ ] Row types and code translation only in `infrastructure/database/mappers`
- [ ] Named parameters, all values bound, OUT binds typed
- [ ] Contract error codes → application errors; everything else rethrown
- [ ] Cursors closed in `finally`
- [ ] `{ contextUser: options?.actor, tag }` on every call
- [ ] Unit tests + live test with a stub of their package
