import { UnauthorizedError } from '@application/errors';
import type { LoggerPort } from '@application/ports';
import type { OracleSourceConfig } from '@infrastructure/config/schemas';
import { DatabaseConnectionError } from '@infrastructure/database/errors';
import type { ConnectionOptions, PoolStats } from '@infrastructure/database/types';
import type { Connection, ExecuteOptions, Pool } from 'oracledb';
import type { DatabaseClient } from './database-client.interface';
import { mapOracleError } from './oracle/oracle-error.mapper';
import { toExecuteDefaults } from './oracle/oracle-pool.options';

const SQL_LOG_MAX = 500;

/** Oracle implementation using node-oracledb.Pool */
export class OracleClient implements DatabaseClient {
    readonly implemented = true;

    private readonly executeDefaults: ExecuteOptions;

    constructor(
        private readonly pool: Pool,
        private readonly source: OracleSourceConfig,
        private readonly logger: LoggerPort,
    ) {
        this.executeDefaults = toExecuteDefaults(source);
    }

    private get sourceKey(): string {
        return this.source.key;
    }

    /**
     * Borrow a connection, run `fn`, always return it to the pool.
     *
     * Context user lifecycle (per call):
     * 1. `connection.clientId = user` — piggybacked on the first round trip, no extra call.
     * 2. run `fn`
     * 3. `clientId = ''` + `ping()` to flush the clear before release.
     *    If that fails the connection is dropped, so the identity can never leak to the next borrower.
     */
    async withConnection<T, C = Connection>(
        fn: (conn: C) => Promise<T>,
        options?: ConnectionOptions,
    ): Promise<T> {
        const contextUser = this.resolveContextUser(options);

        let connection: Connection;
        try {
            connection = await this.pool.getConnection();
        } catch (e) {
            // Wrap acquisition errors with a typed infrastructure error
            throw new DatabaseConnectionError(this.sourceKey, e);
        }

        const callTimeout = options?.callTimeoutMs ?? this.source.callTimeoutMs;
        if (callTimeout > 0) connection.callTimeout = callTimeout;
        if (contextUser) connection.clientId = contextUser;

        try {
            return await fn(this.withExecuteDefaults(connection, options?.tag) as C);
        } catch (e) {
            throw mapOracleError(e, this.sourceKey, options?.tag);
        } finally {
            await this.release(connection, !!contextUser);
        }
    }

    async transaction<T, C = Connection>(
        fn: (conn: C) => Promise<T>,
        options?: ConnectionOptions,
    ): Promise<T> {
        return this.withConnection<T, Connection>(async (connection) => {
            try {
                const result = await fn(connection as C);
                await connection.commit();
                return result;
            } catch (e) {
                try {
                    await connection.rollback();
                } catch (rollbackError) {
                    this.logger.warn('db.rollback.failed', {
                        sourceKey: this.sourceKey,
                        tag: options?.tag,
                        err: rollbackError,
                    });
                }
                throw e;
            }
        }, options);
    }

    async ping(timeoutMs = 3000): Promise<void> {
        const started = Date.now();
        // callTimeout aborts the round trip itself (a Promise.race would leave it running)
        await this.withConnection(
            async (connection: Connection) => {
                if (this.source.healthQuery === 'SELECT 1 FROM DUAL') await connection.ping();
                else await connection.execute(this.source.healthQuery);
            },
            { callTimeoutMs: timeoutMs, tag: 'ping' },
        );
        this.logger.debug('db.ping.ok', {
            sourceKey: this.sourceKey,
            latencyMs: Date.now() - started,
        });
    }

    stats(): PoolStats | undefined {
        if (!this.source.enableStatistics) {
            return {
                connectionsOpen: this.pool.connectionsOpen,
                connectionsInUse: this.pool.connectionsInUse,
                poolMin: this.pool.poolMin,
                poolMax: this.pool.poolMax,
            };
        }
        return this.pool.getStatistics() as unknown as PoolStats;
    }

    async close(): Promise<void> {
        await this.pool.close(this.source.drainTimeSec);
    }

    private resolveContextUser(options?: ConnectionOptions): string | undefined {
        const { enabled, required, maxLength } = this.source.contextUser;
        const raw = (options?.contextUser ?? options?.username)?.trim();

        if (!enabled) return undefined;

        if (!raw) {
            if (required) {
                throw new UnauthorizedError(
                    `Database source "${this.sourceKey}" requires a context user`,
                );
            }
            return undefined;
        }

        return truncateBytes(raw, maxLength);
    }

    private async release(connection: Connection, clearContext: boolean): Promise<void> {
        let drop = false;

        if (clearContext) {
            try {
                connection.clientId = '';
                connection.callTimeout = this.source.poolPingTimeoutMs || 5000;
                await connection.ping(); // round trip that carries the cleared identifier
            } catch (e) {
                drop = true;
                this.logger.warn('db.context.clear.failed', {
                    sourceKey: this.sourceKey,
                    action: 'drop-connection',
                    err: e,
                });
            }
        }

        try {
            connection.callTimeout = this.source.callTimeoutMs;
            await connection.close({ drop });
        } catch (e) {
            this.logger.warn('db.connection.release.failed', { sourceKey: this.sourceKey, err: e });
        }
    }

    /** Applies per-source fetch defaults and slow-query logging to `execute`. */
    private withExecuteDefaults(connection: Connection, tag?: string): Connection {
        const defaults = this.executeDefaults;
        const { slowQueryMs, logSql } = this.source;
        const logger = this.logger;
        const sourceKey = this.sourceKey;

        const execute = async (sql: string, binds: unknown = [], options: ExecuteOptions = {}) => {
            const started = Date.now();
            try {
                return await connection.execute(sql, binds as never, { ...defaults, ...options });
            } finally {
                const latencyMs = Date.now() - started;
                if (slowQueryMs > 0 && latencyMs >= slowQueryMs) {
                    logger.warn('db.query.slow', {
                        sourceKey,
                        tag,
                        latencyMs,
                        sql: logSql ? sql.trim().slice(0, SQL_LOG_MAX) : undefined,
                    });
                } else if (logSql) {
                    logger.debug('db.query', {
                        sourceKey,
                        tag,
                        latencyMs,
                        sql: sql.trim().slice(0, SQL_LOG_MAX),
                    });
                }
            }
        };

        return new Proxy(connection, {
            get(target, prop) {
                if (prop === 'execute') return execute;
                const value: unknown = Reflect.get(target, prop, target);
                return typeof value === 'function'
                    ? ((value as (...args: unknown[]) => unknown).bind(target) as unknown)
                    : value;
            },
            // native accessors (clientId, callTimeout...) must run against the real connection
            set(target, prop, value) {
                return Reflect.set(target, prop, value, target);
            },
        });
    }
}

/** CLIENT_IDENTIFIER is limited in bytes, not characters. */
function truncateBytes(value: string, maxBytes: number): string {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
    let result = '';
    for (const char of value) {
        if (Buffer.byteLength(result + char, 'utf8') > maxBytes) break;
        result += char;
    }
    return result;
}
