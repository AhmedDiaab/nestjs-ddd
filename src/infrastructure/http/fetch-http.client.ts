import type { ConfigPort, LoggerPort, RequestContextPort } from '@application/ports';
import { delay } from '@infrastructure/database/utils';
import { CircuitBreaker } from './circuit-breaker';
import type { HttpClient, HttpRequest, HttpResponse } from './contracts';
import { CircuitOpenError, UpstreamTimeoutError, UpstreamUnavailableError } from './errors';
import {
    isIdempotent,
    isRetryableStatus,
    parseRetryAfter,
    retryDelayMs,
} from './retry-policy.util';

const NO_BODY_METHODS = new Set(['GET', 'HEAD']);

/**
 * Outbound HTTP on the platform's `fetch`, with the four things a call between services needs:
 * a timeout, retries that only repeat what is safe to repeat, a circuit breaker per upstream,
 * and the correlation id of the incoming request so one trace crosses both services.
 *
 * Never logs bodies, headers or query strings: they carry tokens and personal data.
 */
export class FetchHttpClient implements HttpClient {
    private readonly breakers = new Map<string, CircuitBreaker>();

    constructor(
        private readonly config: ConfigPort,
        private readonly logger: LoggerPort,
        private readonly context: RequestContextPort,
        private readonly fetchImpl: typeof fetch = fetch,
    ) {}

    async request<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>> {
        const url = this.buildUrl(request);
        const target = new URL(url).origin;
        const retries = request.retries ?? this.config.get('httpClient.retries');
        const timeoutMs = request.timeoutMs ?? this.config.get('httpClient.timeoutMs');
        const retryable = isIdempotent(request.method, request.idempotent);
        const breaker = this.breakerFor(target);

        for (let attempt = 0; ; attempt++) {
            const blockedForMs = breaker?.blockedForMs();
            if (blockedForMs !== undefined) {
                this.logger.warn('http.client.circuit.open', {
                    tag: request.tag,
                    target,
                    retryInMs: blockedForMs,
                });
                throw new CircuitOpenError(target, blockedForMs);
            }

            const startedAt = Date.now();
            const outcome = await this.attempt<T>(request, url, timeoutMs);
            const durationMs = Date.now() - startedAt;

            if (outcome.ok) {
                const { response } = outcome;
                // 5xx counts against the upstream's health; a 4xx is this request's problem
                if (response.status >= 500) breaker?.recordFailure();
                else breaker?.recordSuccess();

                const canRetry =
                    retryable && attempt < retries && isRetryableStatus(response.status);
                if (!canRetry) {
                    this.log(response.status, request, target, durationMs, attempt);
                    return response;
                }

                await this.waitBeforeRetry(request, attempt, target, {
                    status: response.status,
                    retryAfterMs: parseRetryAfter(response.headers['retry-after']),
                });
                continue;
            }

            breaker?.recordFailure();

            if (!retryable || attempt >= retries) {
                this.logger.error('http.client.failed', {
                    tag: request.tag,
                    target,
                    method: request.method,
                    durationMs,
                    attempts: attempt + 1,
                    reason: outcome.error instanceof UpstreamTimeoutError ? 'timeout' : 'transport',
                });
                throw outcome.error;
            }

            await this.waitBeforeRetry(request, attempt, target, { reason: 'transport' });
        }
    }

    private async attempt<T>(
        request: HttpRequest,
        url: string,
        timeoutMs: number,
    ): Promise<{ ok: true; response: HttpResponse<T> } | { ok: false; error: Error }> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await this.fetchImpl(url, {
                method: request.method,
                headers: this.buildHeaders(request),
                body: this.buildBody(request),
                signal: controller.signal,
            });

            return { ok: true, response: await this.readResponse<T>(response) };
        } catch (error) {
            const timedOut = controller.signal.aborted;
            return {
                ok: false,
                error: timedOut
                    ? new UpstreamTimeoutError(request.tag, timeoutMs)
                    : new UpstreamUnavailableError(request.tag, error),
            };
        } finally {
            clearTimeout(timer);
        }
    }

    private async readResponse<T>(response: Response): Promise<HttpResponse<T>> {
        const headers: Record<string, string> = {};
        response.headers.forEach((value, key) => (headers[key.toLowerCase()] = value));

        const contentType = headers['content-type'] ?? '';
        const text = await response.text();
        const body = contentType.includes('json') && text ? (JSON.parse(text) as T) : (text as T);

        return { status: response.status, headers, body };
    }

    private buildUrl(request: HttpRequest): string {
        const url = new URL(request.url);
        for (const [key, value] of Object.entries(request.query ?? {})) {
            if (value !== undefined) url.searchParams.set(key, String(value));
        }
        return url.toString();
    }

    private buildHeaders(request: HttpRequest): Record<string, string> {
        const headers: Record<string, string> = {
            accept: 'application/json',
            'user-agent': this.config.get('httpClient.userAgent'),
            ...request.headers,
        };

        if (request.body !== undefined && !NO_BODY_METHODS.has(request.method)) {
            headers['content-type'] ??= 'application/json';
        }

        // one trace across both services; the header name is the one this service accepts
        const requestId = this.context.get()?.requestId;
        if (requestId) headers[this.config.get('logging.requestIdHeader')] ??= requestId;

        return headers;
    }

    private buildBody(request: HttpRequest): string | undefined {
        if (request.body === undefined || NO_BODY_METHODS.has(request.method)) return undefined;
        return typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
    }

    private breakerFor(target: string): CircuitBreaker | undefined {
        if (!this.config.get('httpClient.circuitEnabled')) return undefined;

        const existing = this.breakers.get(target);
        if (existing) return existing;

        const breaker = new CircuitBreaker({
            failureThreshold: this.config.get('httpClient.circuitFailureThreshold'),
            resetMs: this.config.get('httpClient.circuitResetMs'),
        });
        this.breakers.set(target, breaker);
        return breaker;
    }

    private async waitBeforeRetry(
        request: HttpRequest,
        attempt: number,
        target: string,
        cause: { status?: number; retryAfterMs?: number; reason?: string },
    ): Promise<void> {
        const waitMs = retryDelayMs({
            attempt,
            baseMs: this.config.get('httpClient.retryBaseMs'),
            jitterMs: this.config.get('httpClient.retryJitterMs'),
            maxDelayMs: this.config.get('httpClient.retryMaxDelayMs'),
            retryAfterMs: cause.retryAfterMs,
        });

        this.logger.warn('http.client.retry', {
            tag: request.tag,
            target,
            method: request.method,
            attempt: attempt + 1,
            waitMs,
            ...(cause.status !== undefined ? { status: cause.status } : { reason: cause.reason }),
        });

        await delay(waitMs);
    }

    private log(
        status: number,
        request: HttpRequest,
        target: string,
        durationMs: number,
        attempt: number,
    ): void {
        const meta = {
            tag: request.tag,
            target,
            method: request.method,
            status,
            durationMs,
            attempts: attempt + 1,
        };

        if (status >= 500) this.logger.error('http.client.response', meta);
        else this.logger.debug('http.client.response', meta);
    }
}
