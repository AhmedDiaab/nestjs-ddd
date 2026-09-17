import type { ConfigPort, LoggerPort, MetricsPort, RequestContextPort } from '@application/ports';
import {
    CircuitOpenError,
    FetchHttpClient,
    UpstreamTimeoutError,
    UpstreamUnavailableError,
} from '@infrastructure/http';

const defaults: Record<string, unknown> = {
    'httpClient.timeoutMs': 50,
    'httpClient.retries': 2,
    'httpClient.retryBaseMs': 1,
    'httpClient.retryJitterMs': 0,
    'httpClient.retryMaxDelayMs': 10,
    'httpClient.circuitEnabled': false,
    'httpClient.circuitFailureThreshold': 2,
    'httpClient.circuitResetMs': 1000,
    'httpClient.userAgent': 'orders-api/1.0',
    'logging.requestIdHeader': 'x-request-id',
};

const configWith = (overrides: Record<string, unknown> = {}) =>
    ({ get: (key: string) => ({ ...defaults, ...overrides })[key] }) as unknown as ConfigPort;

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });

const metrics: MetricsPort = { increment: jest.fn(), observe: jest.fn(), setGauge: jest.fn() };

const contextWith = (requestId?: string): RequestContextPort => ({
    run: (_context, fn) => fn(),
    get: () => (requestId ? { requestId } : undefined),
});

describe('FetchHttpClient', () => {
    const error = jest.fn();
    const logger: LoggerPort = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error,
    };

    afterEach(() => jest.clearAllMocks());

    it('returns the parsed body, status and lower-cased headers', async () => {
        // Arrange
        const fetchImpl = jest
            .fn()
            .mockResolvedValue(jsonResponse(200, { id: 'a-1' }, { 'X-Upstream': 'accounts' }));
        const sut = new FetchHttpClient(configWith(), logger, contextWith(), metrics, fetchImpl);

        // Act
        const response = await sut.request<{ id: string }>({
            method: 'GET',
            url: 'https://accounts.internal/v1/accounts/a-1',
            tag: 'accounts.get',
        });

        // Assert
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ id: 'a-1' });
        expect(response.headers['x-upstream']).toBe('accounts');
    });

    it('returns a 404 instead of throwing, so the gateway decides what it means', async () => {
        // Arrange
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(404, { error: 'missing' }));
        const sut = new FetchHttpClient(configWith(), logger, contextWith(), metrics, fetchImpl);

        // Act
        const response = await sut.request({
            method: 'GET',
            url: 'https://accounts.internal/v1/accounts/nope',
            tag: 'accounts.get',
        });

        // Assert
        expect(response.status).toBe(404);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('sends the correlation id of the incoming request', async () => {
        // Arrange
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {}));
        const sut = new FetchHttpClient(
            configWith(),
            logger,
            contextWith('req-42'),
            metrics,
            fetchImpl,
        );

        // Act
        await sut.request({
            method: 'GET',
            url: 'https://accounts.internal/v1',
            tag: 'accounts.list',
        });

        // Assert
        const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect((init.headers as Record<string, string>)['x-request-id']).toBe('req-42');
    });

    it('leaves the correlation header out when there is no request context', async () => {
        // Arrange: a cron job, not an HTTP request
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {}));
        const sut = new FetchHttpClient(configWith(), logger, contextWith(), metrics, fetchImpl);

        // Act
        await sut.request({
            method: 'GET',
            url: 'https://accounts.internal/v1',
            tag: 'accounts.list',
        });

        // Assert
        const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
        expect((init.headers as Record<string, string>)['x-request-id']).toBeUndefined();
    });

    it('appends query parameters and drops the undefined ones', async () => {
        // Arrange
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(200, {}));
        const sut = new FetchHttpClient(configWith(), logger, contextWith(), metrics, fetchImpl);

        // Act
        await sut.request({
            method: 'GET',
            url: 'https://accounts.internal/v1/accounts',
            query: { status: 'active', page: 2, cursor: undefined },
            tag: 'accounts.list',
        });

        // Assert
        const [url] = fetchImpl.mock.calls[0] as [string];
        expect(url).toBe('https://accounts.internal/v1/accounts?status=active&page=2');
    });

    it('retries a 503 and returns the answer that finally succeeds', async () => {
        // Arrange
        const fetchImpl = jest
            .fn()
            .mockResolvedValueOnce(jsonResponse(503, {}))
            .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
        const sut = new FetchHttpClient(configWith(), logger, contextWith(), metrics, fetchImpl);

        // Act
        const response = await sut.request({
            method: 'GET',
            url: 'https://accounts.internal/v1',
            tag: 'accounts.list',
        });

        // Assert
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(response.status).toBe(200);
    });

    it('gives up after the configured number of retries and returns the last response', async () => {
        // Arrange
        // a Response body can be read once, so each attempt gets a fresh one
        const fetchImpl = jest.fn(() => Promise.resolve(jsonResponse(503, {})));
        const sut = new FetchHttpClient(
            configWith(),
            logger,
            contextWith(),
            metrics,
            fetchImpl as unknown as typeof fetch,
        );

        // Act
        const response = await sut.request({
            method: 'GET',
            url: 'https://accounts.internal/v1',
            tag: 'accounts.list',
        });

        // Assert: first attempt plus two retries
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(response.status).toBe(503);
    });

    it('does not repeat a POST, because the upstream may already have acted', async () => {
        // Arrange
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(503, {}));
        const sut = new FetchHttpClient(configWith(), logger, contextWith(), metrics, fetchImpl);

        // Act
        const response = await sut.request({
            method: 'POST',
            url: 'https://accounts.internal/v1/accounts',
            body: { name: 'Alice' },
            tag: 'accounts.create',
        });

        // Assert
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(response.status).toBe(503);
    });

    it('repeats a POST the caller marked idempotent', async () => {
        // Arrange
        const fetchImpl = jest
            .fn()
            .mockResolvedValueOnce(jsonResponse(503, {}))
            .mockResolvedValueOnce(jsonResponse(200, {}));
        const sut = new FetchHttpClient(configWith(), logger, contextWith(), metrics, fetchImpl);

        // Act
        const response = await sut.request({
            method: 'POST',
            url: 'https://accounts.internal/v1/accounts',
            body: { name: 'Alice' },
            idempotent: true,
            tag: 'accounts.create',
        });

        // Assert
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(response.status).toBe(200);
    });

    it('does not repeat a 400: the request itself is wrong', async () => {
        // Arrange
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(400, {}));
        const sut = new FetchHttpClient(configWith(), logger, contextWith(), metrics, fetchImpl);

        // Act
        await sut.request({
            method: 'GET',
            url: 'https://accounts.internal/v1',
            tag: 'accounts.list',
        });

        // Assert
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('turns a hanging upstream into a timeout error', async () => {
        // Arrange
        const fetchImpl = jest.fn(
            (_url: string, init?: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () =>
                        reject(new DOMException('aborted', 'AbortError')),
                    );
                }),
        );
        const sut = new FetchHttpClient(
            configWith({ 'httpClient.timeoutMs': 10, 'httpClient.retries': 0 }),
            logger,
            contextWith(),
            metrics,
            fetchImpl as unknown as typeof fetch,
        );

        // Act
        const call = sut.request({
            method: 'GET',
            url: 'https://accounts.internal/v1',
            tag: 'accounts.list',
        });

        // Assert
        await expect(call).rejects.toBeInstanceOf(UpstreamTimeoutError);
    });

    it('turns a connection failure into an unavailable error after its retries', async () => {
        // Arrange
        const fetchImpl = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
        const sut = new FetchHttpClient(configWith(), logger, contextWith(), metrics, fetchImpl);

        // Act
        const call = sut.request({
            method: 'GET',
            url: 'https://accounts.internal/v1',
            tag: 'accounts.list',
        });

        // Assert
        await expect(call).rejects.toBeInstanceOf(UpstreamUnavailableError);
        expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it('opens the circuit after repeated failures and stops calling the upstream', async () => {
        // Arrange
        const fetchImpl = jest.fn(() => Promise.resolve(jsonResponse(500, {})));
        const sut = new FetchHttpClient(
            configWith({ 'httpClient.circuitEnabled': true, 'httpClient.retries': 0 }),
            logger,
            contextWith(),
            metrics,
            fetchImpl as unknown as typeof fetch,
        );
        const call = () =>
            sut.request({
                method: 'GET',
                url: 'https://accounts.internal/v1',
                tag: 'accounts.list',
            });

        // Act
        await call();
        await call();
        const blocked = call();

        // Assert
        await expect(blocked).rejects.toBeInstanceOf(CircuitOpenError);
        expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('keeps each upstream on its own breaker', async () => {
        // Arrange
        const fetchImpl = jest.fn((url: string) =>
            Promise.resolve(jsonResponse(url.includes('accounts') ? 500 : 200, {})),
        );
        const sut = new FetchHttpClient(
            configWith({ 'httpClient.circuitEnabled': true, 'httpClient.retries': 0 }),
            logger,
            contextWith(),
            metrics,
            fetchImpl as unknown as typeof fetch,
        );
        const failing = () =>
            sut.request({
                method: 'GET',
                url: 'https://accounts.internal/v1',
                tag: 'accounts.list',
            });

        // Act
        await failing();
        await failing();
        const healthy = await sut.request({
            method: 'GET',
            url: 'https://billing.internal/v1',
            tag: 'billing.list',
        });

        // Assert: the accounts breaker is open, billing is untouched
        await expect(failing()).rejects.toBeInstanceOf(CircuitOpenError);
        expect(healthy.status).toBe(200);
    });

    it('logs the call without the URL query, headers or body', async () => {
        // Arrange
        const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(500, { secret: 'value' }));
        const sut = new FetchHttpClient(
            configWith({ 'httpClient.retries': 0 }),
            logger,
            contextWith(),
            metrics,
            fetchImpl,
        );

        // Act
        await sut.request({
            method: 'GET',
            url: 'https://accounts.internal/v1/accounts?token=super-secret',
            headers: { authorization: 'Bearer super-secret' },
            tag: 'accounts.list',
        });

        // Assert
        expect(error).toHaveBeenCalledWith('http.client.response', {
            tag: 'accounts.list',
            target: 'https://accounts.internal',
            method: 'GET',
            status: 500,
            durationMs: expect.any(Number) as number,
            attempts: 1,
        });
    });
});
