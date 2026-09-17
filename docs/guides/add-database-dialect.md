# Implement a database dialect

`postgres`, `mysql`, `mariadb`, `mssql` and `sqlite` are validated by the config schema but served by `NotImplementedClient` (throws `UnsupportedDialectError`, 501). This guide replaces one placeholder with a real client.

> The Postgres code below is an **outline**. It isn't compiled in this repository because `pg` isn't a dependency. Adapt it after `pnpm add pg @types/pg`.

## 1. Contract to implement

```ts
// src/infrastructure/database/clients/database-client.interface.ts
export interface DatabaseClient {
    readonly implemented: boolean;
    withConnection<T, C>(fn: (conn: C) => Promise<T>, options?: ConnectionOptions): Promise<T>;
    transaction<T, C>(fn: (conn: C) => Promise<T>, options?: ConnectionOptions): Promise<T>;
    close(): Promise<void>;
    ping(timeoutMs?: number): Promise<void>;
    stats(): PoolStats | undefined;
}
```

Match the Oracle client's guarantees:

- The connection is **always** released (`finally`).
- Acquisition failures → `DatabaseConnectionError`.
- Driver errors → application/infrastructure errors (unique violation → `ConflictError`).
- `contextUser`: set a session-level identity for the call and **reset it before release**. On Postgres: `SET application_name` or `set_config('app.user', $1, false)` + `RESET`. If the reset fails, destroy the connection.
- `callTimeoutMs`: statement timeout for the call (`SET LOCAL statement_timeout` inside a transaction).

## 2. Client (outline)

```ts
// src/infrastructure/database/clients/postgres.client.ts
import { ConflictError } from '@application/errors';
import type { LoggerPort } from '@application/ports';
import { DatabaseConnectionError, DatabaseExecutionError } from '@infrastructure/database/errors';
import type { ConnectionOptions, PoolStats } from '@infrastructure/database/types';
import type { Pool, PoolClient } from 'pg';
import type { DatabaseClient } from './database-client.interface';

export class PostgresClient implements DatabaseClient {
    readonly implemented = true;

    constructor(
        private readonly pool: Pool,
        private readonly key: string,
        private readonly logger: LoggerPort,
    ) {}

    async withConnection<T, C = PoolClient>(
        fn: (conn: C) => Promise<T>,
        options?: ConnectionOptions,
    ): Promise<T> {
        let client: PoolClient;
        try {
            client = await this.pool.connect();
        } catch (e) {
            throw new DatabaseConnectionError(this.key, e);
        }

        const user = (options?.contextUser ?? options?.username)?.trim();
        let destroy = false;
        try {
            if (user) await client.query(`SELECT set_config('app.user', $1, false)`, [user]);
            return await fn(client as C);
        } catch (e) {
            throw mapPostgresError(e, this.key, options?.tag);
        } finally {
            if (user) {
                try {
                    await client.query(`RESET app.user`);
                } catch {
                    destroy = true;
                }
            }
            client.release(destroy); // true = remove from pool
        }
    }

    transaction<T, C = PoolClient>(
        fn: (conn: C) => Promise<T>,
        options?: ConnectionOptions,
    ): Promise<T> {
        return this.withConnection<T, PoolClient>(async (client) => {
            await client.query('BEGIN');
            try {
                const result = await fn(client as C);
                await client.query('COMMIT');
                return result;
            } catch (e) {
                await client.query('ROLLBACK').catch(() => undefined);
                throw e;
            }
        }, options);
    }

    async ping(timeoutMs = 3000): Promise<void> {
        await this.withConnection<void, PoolClient>(async (client) => {
            await client.query(`SET statement_timeout = ${Math.floor(timeoutMs)}`);
            await client.query('SELECT 1');
        });
    }

    stats(): PoolStats {
        return {
            total: this.pool.totalCount,
            idle: this.pool.idleCount,
            waiting: this.pool.waitingCount,
        };
    }

    close(): Promise<void> {
        return this.pool.end();
    }
}

function mapPostgresError(error: unknown, key: string, tag?: string): unknown {
    const code = (error as { code?: string })?.code;
    if (code === '23505') return new ConflictError('Duplicate value', { code, key, tag });
    if (code?.startsWith('08') || code === '57P01') return new DatabaseConnectionError(key, error);
    return code ? new DatabaseExecutionError(key, tag, error, code) : error;
}
```

## 3. Config schema

Extend `PostgresSource` in `src/infrastructure/config/schemas/database.schema.ts` with the options you need (`poolMax`, `statementTimeoutMs`, `ssl`...). Keep the URL-or-parts refinement.

## 4. Wire it in `PoolManager.init`

```ts
case 'postgres': {
    const pool = new Pool(toPgPoolConfig(source)); // pure mapping function, unit-test it
    this.clients.set(source.key, new PostgresClient(pool, source.key, this.logger));
    break;
}
```

Remove `'postgres'` from the placeholder `case` list. Boot pings, `health()` and shutdown pick the client up automatically because `implemented = true`.

## 5. Test

Mirror `test/unit/infrastructure/database/clients/oracle.client.spec.ts`:

- release always happens
- identity set and reset
- destroy on reset failure
- commit/rollback
- error mapping

Plus a `pool.manager.spec.ts` case for the new dialect.
