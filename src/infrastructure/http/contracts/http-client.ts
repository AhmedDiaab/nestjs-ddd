/** Methods that may be retried without asking: sending them twice has the same effect as once. */
export type HttpMethod = 'GET' | 'HEAD' | 'OPTIONS' | 'PUT' | 'DELETE' | 'POST' | 'PATCH';

export type HttpRequest = {
    method: HttpMethod;
    /** Absolute URL. Gateways build it from their own base URL in config. */
    url: string;
    headers?: Record<string, string>;
    query?: Record<string, string | number | boolean | undefined>;
    /** Serialised as JSON unless it is a string; omitted for GET/HEAD. */
    body?: unknown;
    /** Label for logs and errors (`accounts.suspend`), never the URL's query string. */
    tag: string;
    timeoutMs?: number;
    retries?: number;
    /** Retry a POST/PATCH: only when the upstream deduplicates (idempotency key, upsert). */
    idempotent?: boolean;
};

export type HttpResponse<T> = {
    status: number;
    headers: Record<string, string>;
    body: T;
};

/**
 * One outbound call, with timeout, retries and a circuit breaker.
 *
 * Any status is **returned**, never thrown: which status means "refused" is the gateway's
 * business, not the transport's. Only transport failures (timeout, connection, open circuit)
 * throw, as `InfrastructureError`s that map to 503.
 */
export interface HttpClient {
    request<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>>;
}
