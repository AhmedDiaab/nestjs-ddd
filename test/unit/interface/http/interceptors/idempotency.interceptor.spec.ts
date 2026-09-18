import type {
    ClaimOutcome,
    ConfigPort,
    IdempotencyStorePort,
    MetricsPort,
} from '@application/ports';
import { Idempotent } from '@interface/http/decorators';
import {
    IdempotencyInProgressError,
    IdempotencyKeyReusedError,
    MissingIdempotencyKeyError,
} from '@interface/http/errors';
import { IdempotencyInterceptor } from '@interface/http/interceptors/idempotency.interceptor';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Result } from '@shared';
import { Metrics } from '@shared/metrics';
import { lastValueFrom, of, throwError } from 'rxjs';

class DemoController {
    @Idempotent()
    create(this: void) {
        return undefined;
    }

    append(this: void) {
        return undefined;
    }
}

const configWith = (values: Record<string, unknown>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigPort;

describe('IdempotencyInterceptor', () => {
    const reflector = new Reflector();
    const claim = jest.fn();
    const complete = jest.fn();
    const release = jest.fn();
    const increment = jest.fn();
    const store = { claim, complete, release } as unknown as IdempotencyStorePort;
    const metrics = {
        increment,
        observe: jest.fn(),
        setGauge: jest.fn(),
    } as unknown as MetricsPort;
    const config = configWith({ 'idempotency.header': 'idempotency-key' });
    const sut = new IdempotencyInterceptor(reflector, store, config, metrics);

    const contextFor = (
        req: Record<string, unknown>,
        res: object,
        handler: () => unknown = DemoController.prototype.create,
    ): ExecutionContext =>
        ({
            switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
            getHandler: () => handler,
            getClass: () => DemoController,
        }) as unknown as ExecutionContext;

    const baseReq = (overrides: Record<string, unknown> = {}) => ({
        method: 'POST',
        originalUrl: '/v1/orders',
        headers: { 'idempotency-key': 'key-1' },
        body: { total: 10 },
        ...overrides,
    });

    afterEach(() => jest.clearAllMocks());

    it('leaves an undecorated route untouched: the handler runs and the store is never consulted', async () => {
        // Arrange
        const res = { statusCode: 200, status: jest.fn() };
        const context = contextFor(baseReq(), res, DemoController.prototype.append);
        const next: CallHandler = { handle: () => of('ok') };

        // Act
        const stream = await sut.intercept(context, next);

        // Assert
        await expect(lastValueFrom(stream)).resolves.toBe('ok');
        expect(claim).not.toHaveBeenCalled();
    });

    it('claims a new key, runs the handler and stores its response', async () => {
        // Arrange
        claim.mockResolvedValueOnce({ outcome: 'claimed' });
        const res = { statusCode: 201, status: jest.fn() };
        const context = contextFor(baseReq(), res);
        const next: CallHandler = { handle: () => of({ id: 'order-1' }) };

        // Act
        const stream = await sut.intercept(context, next);

        // Assert
        await expect(lastValueFrom(stream)).resolves.toEqual({ id: 'order-1' });
        expect(complete).toHaveBeenCalledWith('key-1', 201, { id: 'order-1' });
        expect(increment).toHaveBeenCalledWith(Metrics.idempotencyRequests, {
            outcome: 'claimed',
        });
    });

    it('replays the stored response without running the handler', async () => {
        // Arrange
        const outcome: ClaimOutcome = { outcome: 'replay', status: 201, body: { id: 'order-1' } };
        claim.mockResolvedValueOnce(outcome);
        const res = { statusCode: 200, status: jest.fn() };
        const context = contextFor(baseReq(), res);
        const handlerRan = jest.fn(() => of({ id: 'should-not-run' }));
        const next: CallHandler = { handle: handlerRan };

        // Act
        const stream = await sut.intercept(context, next);

        // Assert
        await expect(lastValueFrom(stream)).resolves.toEqual({ id: 'order-1' });
        expect(handlerRan).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(201);
        expect(increment).toHaveBeenCalledWith(Metrics.idempotencyRequests, {
            outcome: 'replay',
        });
    });

    it('rejects a reused key sent with a different body with 422', async () => {
        // Arrange
        claim.mockResolvedValueOnce({ outcome: 'mismatch' });
        const res = { statusCode: 200, status: jest.fn() };
        const context = contextFor(baseReq(), res);
        const next: CallHandler = { handle: () => of('should-not-run') };

        // Act
        const intercept = sut.intercept(context, next);

        // Assert
        await expect(intercept).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
        expect(increment).toHaveBeenCalledWith(Metrics.idempotencyRequests, {
            outcome: 'mismatch',
        });
    });

    it('rejects a concurrent call on a still-running key with 409', async () => {
        // Arrange
        claim.mockResolvedValueOnce({ outcome: 'in_progress' });
        const res = { statusCode: 200, status: jest.fn() };
        const context = contextFor(baseReq(), res);
        const next: CallHandler = { handle: () => of('should-not-run') };

        // Act
        const intercept = sut.intercept(context, next);

        // Assert
        await expect(intercept).rejects.toBeInstanceOf(IdempotencyInProgressError);
        expect(increment).toHaveBeenCalledWith(Metrics.idempotencyRequests, {
            outcome: 'in_progress',
        });
    });

    it('rejects a decorated route called without the header with 400', async () => {
        // Arrange
        const res = { statusCode: 200, status: jest.fn() };
        const context = contextFor(baseReq({ headers: {} }), res);
        const next: CallHandler = { handle: () => of('should-not-run') };

        // Act
        const intercept = sut.intercept(context, next);

        // Assert
        await expect(intercept).rejects.toBeInstanceOf(MissingIdempotencyKeyError);
        expect(claim).not.toHaveBeenCalled();
        expect(increment).toHaveBeenCalledWith(Metrics.idempotencyRequests, {
            outcome: 'missing_key',
        });
    });

    it('releases the key when the handler throws, so a retry can re-execute it', async () => {
        // Arrange
        claim.mockResolvedValueOnce({ outcome: 'claimed' });
        const res = { statusCode: 200, status: jest.fn() };
        const context = contextFor(baseReq(), res);
        const next: CallHandler = { handle: () => throwError(() => new Error('boom')) };

        // Act
        const stream = await sut.intercept(context, next);

        // Assert
        await expect(lastValueFrom(stream)).rejects.toThrow('boom');
        expect(release).toHaveBeenCalledWith('key-1');
        expect(complete).not.toHaveBeenCalled();
    });

    it('releases the key when the handler resolves with a failed Result, instead of caching it', async () => {
        // Arrange
        claim.mockResolvedValueOnce({ outcome: 'claimed' });
        const res = { statusCode: 200, status: jest.fn() };
        const context = contextFor(baseReq(), res);
        const next: CallHandler = { handle: () => of(Result.err(new Error('not found'))) };

        // Act
        const stream = await sut.intercept(context, next);
        await lastValueFrom(stream);

        // Assert
        expect(release).toHaveBeenCalledWith('key-1');
        expect(complete).not.toHaveBeenCalled();
    });

    it('fingerprints from the exact request bytes when they were captured', async () => {
        // Arrange
        claim.mockResolvedValueOnce({ outcome: 'claimed' });
        const res = { statusCode: 200, status: jest.fn() };
        const context = contextFor(baseReq({ rawBody: Buffer.from('{"total":10}') }), res);
        const next: CallHandler = { handle: () => of('ok') };

        // Act
        await sut.intercept(context, next);

        // Assert
        expect(claim).toHaveBeenCalledWith('key-1', expect.any(String));
    });
});
