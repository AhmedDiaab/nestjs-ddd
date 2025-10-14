import type { ConfigPort } from '@application/ports/config.port';
import type { LoggerPort } from '@application/ports/logger.port';
import { formatStackTrace } from '@common/utils/format-stack-trace.util';
import { ConfigPortToken } from '@infrastructure/config/config.token';
import { LoggerPortToken } from '@infrastructure/logging/logging.token';
import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Scope,
} from '@nestjs/common';
import { isEnvelope, isRecord } from '@shared/helpers';
import { Meta } from '@shared/response-envelope';
import type { Request, Response } from 'express';
import { ErrorPresenter } from './error-presenter';

@Catch()
@Injectable({ scope: Scope.REQUEST })
export class GlobalExceptionFilter implements ExceptionFilter {
    constructor(
        private readonly errorPresenter: ErrorPresenter,
        @Inject(ConfigPortToken) private readonly config: ConfigPort,
        @Inject(LoggerPortToken) private readonly logger: LoggerPort,
    ) {}

    private showErrorStack(exception: HttpException | Error) {
        if (!this.config.get('logging.showStackTraces')) return;
        return {
            stack: exception.stack,
            message: exception.message,
            printableMessageWithTrace: `- ${exception.message} - \n ${formatStackTrace(exception.stack)}`,
        };
    }

    catch(exception: unknown, host: ArgumentsHost) {
        const context = host.switchToHttp();
        const res = context.getResponse<Response>();
        const req = context.getRequest<Request & { id: string }>();
        const requestIdHeader = this.config.get<string>('logging.requestIdHeader')!;
        const requestId = req.header(requestIdHeader) ?? 'no-id';

        const meta: Meta = {
            timestamp: new Date().toISOString(),
            path: req.url,
            requestId,
        };

        if (exception instanceof HttpException) {
            const status = exception.getStatus();
            const rawResponse = exception.getResponse();
            if (this.config.get('logging.showStackTraces')) {
                if (status >= 500)
                    this.logger.error(
                        `[${requestId}] ${req.method} ${req.url} -> ${status} ${this.showErrorStack(exception)?.printableMessageWithTrace}`,
                        {},
                    );
                else if (status >= 400)
                    this.logger.warn(
                        `[${requestId}] ${req.method} ${req.url} -> ${status} ${this.showErrorStack(exception)?.printableMessageWithTrace}`,
                        {},
                    );
            }

            if (isEnvelope(rawResponse)) {
                res.status(status).json({ ...rawResponse, meta: { ...meta, ...rawResponse.meta } });
                return;
            }

            const body = isRecord(rawResponse)
                ? rawResponse
                : { message: String(rawResponse as unknown) };

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

        const { status, body: errorBody } = this.errorPresenter.present(exception, requestId);

        if (isEnvelope(errorBody)) {
            res.status(status).json({ ...errorBody, meta: { ...meta, ...errorBody.meta } });
            return;
        }

        const record: Record<string, unknown> = isRecord(errorBody) ? errorBody : {};
        const rawMessage = record['message'] ?? record['detail'] ?? record['title'];
        const message = Array.isArray(rawMessage)
            ? rawMessage.join('; ')
            : typeof rawMessage === 'string'
              ? rawMessage
              : undefined;

        const rawCode = record['code'];
        const code = typeof rawCode === 'string' ? rawCode : undefined;

        // prefer explicit 'details', otherwise include domain/app validation 'errors'
        const details = record['details'] ?? record['errors'];

        if (this.config.get('logging.showStackTraces')) {
            if (status >= 500) {
                this.logger.error(
                    `[${requestId}] ${req.method} ${req.url} -> ${status} ${this.showErrorStack(exception as Error)?.printableMessageWithTrace}`,
                    {},
                );
                // this.config.get()
            } else if (status >= 400) {
                this.logger.warn(
                    `[${requestId}] ${req.method} ${req.url} -> ${status} ${this.showErrorStack(exception as Error)?.printableMessageWithTrace}`,
                    {},
                );
            }
        }

        return res.status(status).json({
            success: false,
            error: {
                message: message ?? HttpStatus[status] ?? 'Error',
                code,
                details,
                type: record.type,
            },
            meta,
        });
    }
}
