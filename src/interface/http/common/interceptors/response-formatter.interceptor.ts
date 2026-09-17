import { Readable } from 'node:stream';
import { RAW_RESPONSE } from '@interface/http/decorators';
import {
    Injectable,
    StreamableFile,
    UnprocessableEntityException,
    type CallHandler,
    type ExecutionContext,
    type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    isEnvelope,
    isPresentableError,
    isRecord,
    isResultLike,
    Result,
    SKIP_FORMAT_HEADER,
    type Meta,
} from '@shared';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseFormatterInterceptor implements NestInterceptor {
    constructor(private readonly reflector: Reflector) {}

    intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
        const http = ctx.switchToHttp();
        const req = http.getRequest<Request>();
        const res = http.getResponse<Response>();

        if (req.headers[SKIP_FORMAT_HEADER]) return next.handle();
        // @RawResponse(): the consumer defines the format (Prometheus, files, webhooks)
        if (
            this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
                ctx.getHandler(),
                ctx.getClass(),
            ])
        ) {
            return next.handle();
        }
        if (res.headersSent) return next.handle();

        const meta: Meta = {
            timestamp: new Date().toISOString(),
            path: req.originalUrl || req.url,
            requestId: typeof req.id === 'string' ? req.id : null,
        };

        return next.handle().pipe(
            map((body: unknown): unknown => {
                if (
                    body instanceof Buffer ||
                    body instanceof StreamableFile ||
                    body instanceof Readable
                ) {
                    return body;
                }

                if (isEnvelope(body)) {
                    return { ...body, meta: { ...meta, ...body.meta } };
                }

                if (isResultLike(body)) {
                    if (Result.isOk(body)) {
                        return { success: true as const, data: body.value, meta };
                    }
                    if (Result.isErr(body)) {
                        // Rethrow so GlobalExceptionFilter sets the real HTTP status.
                        // AppError/DomainError → mapped by kind; anything else → 422.
                        if (body.error instanceof Error && isPresentableError(body.error)) {
                            throw body.error;
                        }

                        const errObj = isRecord(body.error) ? body.error : undefined;
                        throw new UnprocessableEntityException({
                            message: (errObj?.message as string | undefined) ?? 'Operation failed',
                            code:
                                typeof body.error === 'string'
                                    ? body.error
                                    : (errObj?.code as string | undefined),
                            details: errObj?.details,
                        });
                    }
                }

                return { success: true as const, data: body, meta };
            }),
        );
    }
}
