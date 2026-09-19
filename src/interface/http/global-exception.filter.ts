import type { ConfigPort, LoggerPort } from '@application/ports';
import { ConfigPortToken, LoggerPortToken } from '@application/ports';
import { formatStackTrace } from '@common/utils';
import {
    Catch,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    type ArgumentsHost,
    type ExceptionFilter,
} from '@nestjs/common';
import { isEnvelope, isRecord, type Meta } from '@shared';
import type { Request, Response } from 'express';
import { ErrorPresenter } from './error-presenter';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
    constructor(
        private readonly errorPresenter: ErrorPresenter,
        @Inject(ConfigPortToken) private readonly config: ConfigPort,
        @Inject(LoggerPortToken) private readonly logger: LoggerPort,
    ) {}

    /**
     * 5xx are always logged (with the cause chain); 4xx only as warn.
     * Stack traces are included only when SHOW_STACK_TRACES=true.
     */
    private log(exception: unknown, status: number, req: Request, requestId: string): void {
        if (status < 400) return;

        const showStack = !!this.config.get('logging.showStackTraces');
        const error = exception instanceof Error ? exception : undefined;
        const cause = (error as { cause?: unknown } | undefined)?.cause;
        const message = `[${requestId}] ${req.method} ${req.originalUrl} -> ${status} - ${error?.message ?? String(exception)}`;

        const meta = {
            correlationId: requestId,
            http: { method: req.method, url: req.originalUrl, status },
            errorName: error?.name,
            cause:
                cause instanceof Error ? { name: cause.name, message: cause.message } : undefined,
            stack: showStack ? formatStackTrace(error?.stack) : undefined,
        };

        if (status >= 500) this.logger.error(message, meta);
        else this.logger.warn(message, meta);
    }

    catch(exception: unknown, host: ArgumentsHost) {
        const context = host.switchToHttp();
        const res = context.getResponse<Response>();
        const req = context.getRequest<Request>();
        // req.id is set by pino-http; errors raised before it (e.g. body parsing) fall back to the header
        const headerName = this.config.get('logging.requestIdHeader') ?? 'x-request-id';
        const headerId = req.headers?.[headerName];
        const requestId =
            typeof req.id === 'string' ? req.id : typeof headerId === 'string' ? headerId : 'no-id';

        const meta: Meta = {
            timestamp: new Date().toISOString(),
            path: req.originalUrl || req.url,
            requestId,
        };

        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const rawResponse = exception.getResponse();
            this.log(exception, status, req, requestId);

            if (isEnvelope(rawResponse)) {
                res.status(status).json({ ...rawResponse, meta: { ...meta, ...rawResponse.meta } });
                return;
            }

            const body = isRecord(rawResponse)
                ? rawResponse
                : { message: typeof rawResponse === 'string' ? rawResponse : undefined };

            const message = Array.isArray(body.message)
                ? body.message.join('; ')
                : (body.message as string | undefined);

            const code = (body.code as string | undefined) ?? undefined;
            const details = body.details;

            return res.status(status).json({
                success: false,
                error: { message: message ?? HttpStatus[status] ?? 'Error', code, details },
                meta,
            });
        }

        // body-parser / http-errors (payload too large, malformed JSON): client errors, not 500
        const clientError = asExposedClientError(exception);
        if (clientError) {
            this.log(exception, clientError.status, req, requestId);
            return res.status(clientError.status).json({
                success: false,
                error: { message: clientError.message, code: clientError.type },
                meta,
            });
        }

        const { status, body: problem } = this.errorPresenter.present(exception, requestId);
        this.log(exception, status, req, requestId);

        return res.status(status).json({
            success: false,
            error: {
                message: problem.detail ?? problem.title ?? HttpStatus[status] ?? 'Error',
                code: problem.code,
                // domain/app validation field errors only; never internal `details`
                details: problem.errors,
                type: problem.type,
            },
            meta,
        });
    }
}

/** `http-errors` shape used by express middleware: `expose` is true only for safe 4xx messages. */
function asExposedClientError(
    exception: unknown,
): { status: number; message: string; type?: string } | undefined {
    if (!isRecord(exception) && !(exception instanceof Error)) return undefined;
    const e = exception as {
        status?: unknown;
        expose?: unknown;
        message?: unknown;
        type?: unknown;
    };
    if (e.expose !== true || typeof e.status !== 'number') return undefined;
    if (e.status < 400 || e.status >= 500) return undefined;
    return {
        status: e.status,
        message: typeof e.message === 'string' ? e.message : (HttpStatus[e.status] ?? 'Error'),
        type: typeof e.type === 'string' ? e.type : undefined,
    };
}
