import type { ConnectionOptions, PoolStats } from '@infrastructure/database/types';

/** Minimal client interface each dialect-specific pool/client must implement */
export interface DatabaseClient {
    /** false for placeholder dialects */
    readonly implemented: boolean;
    withConnection<T, C>(fn: (conn: C) => Promise<T>, options?: ConnectionOptions): Promise<T>;
    /** Runs `fn` on one connection; commits on success, rolls back on error. */
    transaction<T, C>(fn: (conn: C) => Promise<T>, options?: ConnectionOptions): Promise<T>;
    close(): Promise<void>;
    ping(timeoutMs?: number): Promise<void>;
    stats(): PoolStats | undefined;
}
