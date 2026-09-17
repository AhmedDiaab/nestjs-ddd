export type ConnectionOptions = {
    /**
     * End user the database should attribute this work to.
     * Oracle: set as CLIENT_IDENTIFIER for the call and cleared before the connection returns to the pool.
     */
    contextUser?: string;
    /** Per round-trip timeout override (ms). */
    callTimeoutMs?: number;
    /** Label for logs/errors (e.g. "site.getDetails"). Never the SQL text. */
    tag?: string;
    /** @deprecated use `contextUser` */
    username?: string;
};

export type PoolStats = Record<string, unknown>;
