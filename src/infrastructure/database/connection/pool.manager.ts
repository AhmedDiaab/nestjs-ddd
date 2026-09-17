import { AsyncLocalStorage } from 'node:async_hooks';
import type { LoggerPort } from '@application/ports';
import { LoggerPortToken } from '@application/ports';
import type { DatabaseConfig, DatabaseSource } from '@infrastructure/config/schemas';
import {
    initOracleDriver,
    NotImplementedClient,
    OracleClient,
    toPoolAttributes,
    type DatabaseClient,
} from '@infrastructure/database/clients';
import type {
    ConnectionProvider as ConnectionProviderContract,
    PingAllOptions,
    SourceHealth,
} from '@infrastructure/database/contracts';
import {
    AggregateDbHealthError,
    DatabaseConnectionError,
    UnknownSourceKeyError,
    type DbHealthFailure,
} from '@infrastructure/database/errors';
import type { ConnectionOptions } from '@infrastructure/database/types';
import { delay, expoBackoff, jitterDelay, Semaphore } from '@infrastructure/database/utils';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import oracledb from 'oracledb';

type Dialect = DatabaseSource['dialect'];

@Injectable()
export class PoolManager implements ConnectionProviderContract, OnModuleDestroy {
    private clients = new Map<string, DatabaseClient>();
    /** Connections of transactions opened by `runInTransaction`, per source, for the current async flow. */
    private readonly activeTransactions = new AsyncLocalStorage<ReadonlyMap<string, unknown>>();
    private meta = new Map<string, { dialect: Dialect; defaultSchema?: string }>();

    constructor(
        @Inject(LoggerPortToken)
        private readonly logger: LoggerPort,
    ) {}

    hasSource(sourceKey: string): boolean {
        return this.clients.has(sourceKey);
    }

    getDialect(sourceKey: string): Dialect {
        const m = this.meta.get(sourceKey);
        if (!m) throw new UnknownSourceKeyError(sourceKey);
        return m.dialect;
    }

    /**
     * Initialize one client per configured source. Oracle is fully implemented.
     * Other dialects attach a placeholder that throws until you add their client.
     */
    async init(config: DatabaseConfig): Promise<void> {
        for (const source of config.sources) {
            if (this.clients.has(source.key)) continue;

            this.meta.set(source.key, {
                dialect: source.dialect,
                defaultSchema: source.defaultSchema,
            });

            switch (source.dialect) {
                case 'oracle': {
                    initOracleDriver(config.oracle);
                    let pool: oracledb.Pool;
                    try {
                        pool = await oracledb.createPool(toPoolAttributes(source));
                    } catch (e) {
                        throw new DatabaseConnectionError(source.key, e);
                    }
                    this.clients.set(source.key, new OracleClient(pool, source, this.logger));
                    this.logger.info(`[${source.key}] db.pool.created`, {
                        sourceKey: source.key,
                        dialect: source.dialect,
                        mode: oracledb.thin ? 'thin' : 'thick',
                        poolMin: source.poolMin,
                        poolMax: source.poolMax,
                    });
                    break;
                }

                case 'postgres':
                case 'mysql':
                case 'mariadb':
                case 'mssql':
                case 'sqlite': {
                    // Register a placeholder; it will throw UnsupportedDialectError when used.
                    this.clients.set(
                        source.key,
                        new NotImplementedClient(source.key, source.dialect),
                    );
                    break;
                }
            }
        }
    }

    private client(sourceKey: string): DatabaseClient {
        const client = this.clients.get(sourceKey);
        if (!client) throw new UnknownSourceKeyError(sourceKey);
        return client;
    }

    async withConnection<T, C>(
        sourceKey: string,
        fn: (conn: C) => Promise<T>,
        options?: ConnectionOptions,
    ): Promise<T> {
        const joined = this.joinedConnection<C>(sourceKey);
        if (joined) return this.runJoined(sourceKey, joined.connection, fn, options);
        return this.client(sourceKey).withConnection(fn, options);
    }

    async transaction<T, C>(
        sourceKey: string,
        fn: (conn: C) => Promise<T>,
        options?: ConnectionOptions,
    ): Promise<T> {
        // inside runInTransaction: join the outer transaction, which commits or rolls back once
        const joined = this.joinedConnection<C>(sourceKey);
        if (joined) return this.runJoined(sourceKey, joined.connection, fn, options);
        return this.client(sourceKey).transaction(fn, options);
    }

    /**
     * Runs `work` in one transaction on `sourceKey`. Every `withConnection`/`transaction` call for
     * that source made inside `work` (in the same async flow) reuses the transaction's connection
     * instead of borrowing its own, so repositories write atomically without passing connections.
     * Commits when `work` resolves, rolls back when it throws. Nested calls join the outer one.
     * The context user of the outer call applies to all joined calls.
     */
    async runInTransaction<T>(
        sourceKey: string,
        work: () => Promise<T>,
        options?: ConnectionOptions,
    ): Promise<T> {
        if (this.joinedConnection(sourceKey)) return work();

        return this.client(sourceKey).transaction(async (connection: unknown) => {
            const active = new Map(this.activeTransactions.getStore() ?? []);
            active.set(sourceKey, connection);
            return this.activeTransactions.run(active, work);
        }, options);
    }

    /** Joined calls get the same error mapping as a normal call (e.g. ORA-00001 → ConflictError). */
    private async runJoined<T, C>(
        sourceKey: string,
        connection: C,
        fn: (conn: C) => Promise<T>,
        options?: ConnectionOptions,
    ): Promise<T> {
        try {
            return await fn(connection);
        } catch (e) {
            throw this.client(sourceKey).mapError(e, options?.tag);
        }
    }

    private joinedConnection<C>(sourceKey: string): { connection: C } | undefined {
        const store = this.activeTransactions.getStore();
        return store?.has(sourceKey) ? { connection: store.get(sourceKey) as C } : undefined;
    }

    async ping(sourceKey: string, timeoutMs = 3000): Promise<boolean> {
        const c = this.clients.get(sourceKey);
        if (!c) throw new UnknownSourceKeyError(sourceKey, 'ping_lookup');
        await c.ping(timeoutMs);
        return true;
    }

    async pingAll(opts?: PingAllOptions): Promise<void> {
        const {
            timeoutMs = 3000,
            retries = 2,
            requiredSet,
            concurrency = 3,
            jitterMs = 250,
        } = opts ?? {};

        const implementedKeys = [...this.clients.entries()]
            .filter(([, client]) => client.implemented)
            .map(([key]) => key);
        const placeholderKeys = [...this.clients.entries()]
            .filter(([, client]) => !client.implemented)
            .map(([key]) => key);

        const reqSet = requiredSet && requiredSet.size > 0 ? requiredSet : new Set(implementedKeys);

        const failures: DbHealthFailure[] = [];

        // placeholders cannot be pinged: fail fast only if someone marked them required
        for (const key of placeholderKeys) {
            const dialect = this.meta.get(key)?.dialect ?? 'unknown';
            if (reqSet.has(key)) {
                failures.push({
                    sourceKey: key,
                    dialect,
                    message: `dialect "${dialect}" is not implemented`,
                    attempts: 0,
                });
            } else {
                this.logger.warn(`[${key}] db.ping.skipped [not implemented]`, {
                    sourceKey: key,
                    dialect,
                });
            }
        }

        const sem = new Semaphore(concurrency);

        await jitterDelay(jitterMs); // avoid thundering herd on startup

        await Promise.all(
            implementedKeys.map((key) =>
                sem.with(async () => {
                    const dialect = this.meta.get(key)?.dialect ?? 'unknown';
                    const required = reqSet.has(key);
                    let attempt = 0;
                    let lastError: unknown;
                    let lastLatency = 0;

                    while (attempt <= retries) {
                        attempt++;
                        const started = Date.now();
                        try {
                            await this.ping(key, timeoutMs);
                            this.logger.info(`[${key}] db.ping.success`, {
                                sourceKey: key,
                                dialect,
                                required,
                                attempt,
                            });
                            return;
                        } catch (e: unknown) {
                            lastError = e;
                            lastLatency = Date.now() - started;
                            if (attempt <= retries) {
                                await delay(expoBackoff(attempt - 1));
                            }
                        }
                    }

                    // All retries exhausted
                    const failure: DbHealthFailure = {
                        sourceKey: key,
                        dialect,
                        message: errorMessage(lastError),
                        attempts: retries + 1,
                        latencyMs: lastLatency,
                    };

                    if (required) {
                        failures.push(failure);
                        this.logger.error(`[${key}] db.ping.fail [required]`, { ...failure });
                    } else {
                        this.logger.warn(`[${key}] db.ping.fail [optional]`, { ...failure });
                    }
                }),
            ),
        );

        if (failures.length > 0) {
            throw new AggregateDbHealthError(failures);
        }
    }

    async health(timeoutMs = 3000): Promise<SourceHealth[]> {
        return Promise.all(
            [...this.clients.entries()].map(async ([key, client]): Promise<SourceHealth> => {
                const dialect = this.getDialect(key);
                const started = Date.now();
                if (!client.implemented) {
                    return { sourceKey: key, dialect, implemented: false, ok: false, latencyMs: 0 };
                }
                try {
                    await client.ping(timeoutMs);
                    return {
                        sourceKey: key,
                        dialect,
                        implemented: true,
                        ok: true,
                        latencyMs: Date.now() - started,
                        pool: client.stats(),
                    };
                } catch (e) {
                    return {
                        sourceKey: key,
                        dialect,
                        implemented: true,
                        ok: false,
                        latencyMs: Date.now() - started,
                        error: errorMessage(e),
                    };
                }
            }),
        );
    }

    async onModuleDestroy(): Promise<void> {
        const results = await Promise.allSettled(
            [...this.clients.entries()].map(async ([key, client]) => {
                await client.close();
                this.logger.info(`[${key}] db.pool.closed`, { sourceKey: key });
            }),
        );
        for (const result of results) {
            if (result.status === 'rejected') {
                this.logger.warn('db.pool.close.failed', { err: result.reason });
            }
        }
        this.clients.clear();
    }
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        const cause = (error as { cause?: unknown }).cause;
        return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message;
    }
    return String(error);
}
