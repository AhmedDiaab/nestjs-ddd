import type { DatabaseSource } from '@infrastructure/config/schemas';
import type { ConnectionOptions, PoolStats } from '@infrastructure/database/types';

export type PingAllOptions = {
    timeoutMs?: number;
    retries?: number;
    requiredSet?: Set<string>;
    concurrency?: number;
    jitterMs?: number;
};

export type SourceHealth = {
    sourceKey: string;
    dialect: DatabaseSource['dialect'];
    implemented: boolean;
    ok: boolean;
    latencyMs: number;
    error?: string;
    pool?: PoolStats;
};

/**
 * Narrow public API for infrastructure adapters (DAOs). Keep this in infrastructure.
 */
export interface ConnectionProvider {
    /** Obtain a connection from a named source/pool and run a function with it */
    withConnection<T, C = unknown>(
        sourceKey: string,
        fn: (conn: C) => Promise<T>,
        options?: ConnectionOptions,
    ): Promise<T>;
    /** Same as withConnection, wrapped in commit/rollback */
    transaction<T, C = unknown>(
        sourceKey: string,
        fn: (conn: C) => Promise<T>,
        options?: ConnectionOptions,
    ): Promise<T>;
    /**
     * One transaction around `work`; adapter calls for the same source inside it share its
     * connection. Backs the application `UnitOfWorkPort`.
     */
    runInTransaction<T>(
        sourceKey: string,
        work: () => Promise<T>,
        options?: ConnectionOptions,
    ): Promise<T>;
    /** True if a sourceKey is configured */
    hasSource(sourceKey: string): boolean;
    /** Return the configured dialect for a sourceKey */
    getDialect(sourceKey: string): DatabaseSource['dialect'];

    ping(sourceKey: string, timeoutMs?: number): Promise<boolean>;
    pingAll(opts?: PingAllOptions): Promise<void>;
    /** Non-throwing per-source health, for readiness probes */
    health(timeoutMs?: number): Promise<SourceHealth[]>;
    /** Pool counters per source, without touching the database (for metrics) */
    poolStats(): Record<string, PoolStats | undefined>;
}
