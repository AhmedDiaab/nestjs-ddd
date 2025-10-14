import { Readable } from 'node:stream';
import type { ConfigPort } from '@application/ports/config.port';
import { ConfigPortToken } from '@infrastructure/config/config.token';
import {
    CallHandler,
    ExecutionContext,
    Inject,
    Injectable,
    NestInterceptor,
    StreamableFile,
} from '@nestjs/common';
import { isEnvelope, isRecord, isResultLike } from '@shared/helpers';
import type { Meta } from '@shared/response-envelope';
import { SKIP_FORMAT_HEADER } from '@shared/response-envelope';
import { Result } from '@shared/result';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ResponseFormatterInterceptor implements NestInterceptor {
    constructor(@Inject(ConfigPortToken) private readonly config: ConfigPort) {}
    intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
        const http = ctx.switchToHttp();
        const req = http.getRequest<Request>();
        const res = http.getResponse<Response>();
        const requestIdHeader = this.config.get<string>('logging.requestIdHeader')!;

        if (req.headers[SKIP_FORMAT_HEADER]) return next.handle();
        if (res.headersSent) return next.handle();

        const meta: Meta = {
            timestamp: new Date().toISOString(),
            path: req.originalUrl || req.url,
            requestId: requestIdHeader,
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
                        const errObj = isRecord(body.error) ? body.error : undefined;
                        const message =
                            (errObj?.message as string | undefined) ?? 'Operation failed';
                        const code = errObj?.code as string | undefined;
                        const details = errObj?.details;
                        return {
                            success: false as const,
                            error: { message, code, details },
                            meta,
                        };
                    }
                }

                return { success: true as const, data: body, meta };
            }),
        );
    }
}
