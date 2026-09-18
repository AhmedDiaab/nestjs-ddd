import { createHash } from 'node:crypto';
import {
    ConfigPortToken,
    IdempotencyStorePortToken,
    MetricsPortToken,
    type ConfigPort,
    type IdempotencyStorePort,
    type MetricsPort,
} from '@application/ports';
import { IS_IDEMPOTENT } from '@interface/http/decorators';
import {
    IdempotencyInProgressError,
    IdempotencyKeyReusedError,
    MissingIdempotencyKeyError,
} from '@interface/http/errors';
import {
    Inject,
    Injectable,
    type CallHandler,
    type ExecutionContext,
    type NestInterceptor,
    type RawBodyRequest,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isResultLike, isSafeCorrelationId, Result } from '@shared';
import { Metrics } from '@shared/metrics';
import type { Request, Response } from 'express';
import { defer, of, type Observable } from 'rxjs';
import { catchError, concatMap } from 'rxjs/operators';

type Outcome = 'claimed' | 'replay' | 'mismatch' | 'in_progress' | 'missing_key';

/**
 * Backs `@Idempotent()`: registered in `interface.module.ts` **after**
 * `ResponseFormatterInterceptor`, so it is the innermost interceptor. That matters — it stores
 * the handler's raw payload, not the `{ success, data, meta }` envelope, so a replay is
 * re-wrapped with the replaying request's own `requestId`/`timestamp` instead of resurrecting
 * the original's.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
    constructor(
        private readonly reflector: Reflector,
        @Inject(IdempotencyStorePortToken) private readonly store: IdempotencyStorePort,
        @Inject(ConfigPortToken) private readonly config: ConfigPort,
        @Inject(MetricsPortToken) private readonly metrics: MetricsPort,
    ) {}

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
        const isIdempotent = this.reflector.getAllAndOverride<boolean>(IS_IDEMPOTENT, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!isIdempotent) return next.handle();

        const http = context.switchToHttp();
        const req = http.getRequest<RawBodyRequest<Request>>();
        const res = http.getResponse<Response>();

        const headerName = this.config.get('idempotency.header');
        const header = req.headers[headerName];
        const key = Array.isArray(header) ? header[0] : header;

        if (!isSafeCorrelationId(key)) {
            this.count('missing_key');
            throw new MissingIdempotencyKeyError(headerName);
        }

        const fingerprint = this.fingerprint(req);
        const outcome = await this.store.claim(key, fingerprint);

        if (outcome.outcome === 'mismatch') {
            this.count('mismatch');
            throw new IdempotencyKeyReusedError();
        }

        if (outcome.outcome === 'in_progress') {
            this.count('in_progress');
            throw new IdempotencyInProgressError();
        }

        if (outcome.outcome === 'replay') {
            this.count('replay');
            res.status(outcome.status);
            return of(outcome.body);
        }

        this.count('claimed');
        return next.handle().pipe(
            concatMap(async (body: unknown) => {
                if (isResultLike(body) && Result.isErr(body)) {
                    await this.store.release(key);
                } else {
                    await this.store.complete(key, res.statusCode, body);
                }
                return body;
            }),
            catchError((error: unknown) =>
                defer(async () => {
                    await this.store.release(key);
                    throw error;
                }),
            ),
        );
    }

    private count(outcome: Outcome): void {
        this.metrics.increment(Metrics.idempotencyRequests, { outcome });
    }

    /** SHA-256 of method + path + the exact request bytes, so a re-serialized body can't fool it. */
    private fingerprint(req: RawBodyRequest<Request>): string {
        const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? null);
        return createHash('sha256').update(`${req.method}:${req.originalUrl}:${raw}`).digest('hex');
    }
}
