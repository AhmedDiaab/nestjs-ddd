import type { HttpMethod } from './contracts';

/** Retried without asking: sending them twice has the same effect as sending them once. */
const IDEMPOTENT_METHODS = new Set<HttpMethod>(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

/**
 * Statuses worth sending again: the upstream said "not now", not "no".
 * 4xx other than these mean the request itself is wrong; repeating it wastes both sides' time.
 */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isIdempotent(method: HttpMethod, explicit?: boolean): boolean {
    return explicit ?? IDEMPOTENT_METHODS.has(method);
}

export function isRetryableStatus(status: number): boolean {
    return RETRYABLE_STATUSES.has(status);
}

/** `Retry-After` in seconds or as an HTTP date; `undefined` when absent or unparsable. */
export function parseRetryAfter(header: string | undefined, now = Date.now()): number | undefined {
    if (!header) return undefined;

    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

    const date = Date.parse(header);
    return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export type RetryDelayOptions = {
    attempt: number; // 0 for the delay after the first failure
    baseMs: number;
    jitterMs: number;
    maxDelayMs: number;
    retryAfterMs?: number;
};

/**
 * Exponential backoff with jitter, capped. A `Retry-After` from the upstream wins: it knows
 * when it will be ready, and ignoring it is how a thundering herd forms.
 */
export function retryDelayMs({
    attempt,
    baseMs,
    jitterMs,
    maxDelayMs,
    retryAfterMs,
}: RetryDelayOptions): number {
    if (retryAfterMs !== undefined) return Math.min(retryAfterMs, maxDelayMs);

    const backoff = Math.pow(2, attempt) * baseMs;
    const jitter = Math.floor(Math.random() * jitterMs);
    return Math.min(backoff + jitter, maxDelayMs);
}
