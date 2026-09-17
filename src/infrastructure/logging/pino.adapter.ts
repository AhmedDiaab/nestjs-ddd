import { LoggerPort, RequestContextPortToken, type RequestContextPort } from '@application/ports';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

/**
 * `PinoLogger` takes the merged object **first** and the message second. Passing the meta as a
 * second argument matches its `(msg, ...args)` overload instead, and the fields are dropped:
 * the line still prints, so the loss is invisible until someone looks for a field in production.
 *
 * Every line also carries the trace of the request being handled, so logs from this service and
 * from the ones it calls can be lined up without a tracing backend.
 */
@Injectable()
export class PinoLoggerAdapter implements LoggerPort {
    constructor(
        private readonly logger: PinoLogger,
        @Inject(RequestContextPortToken) private readonly context: RequestContextPort,
    ) {}

    debug(message: string, meta?: Record<string, unknown>): void {
        this.logger.debug(this.withTrace(meta), message);
    }

    info(message: string, meta: Record<string, unknown>): void {
        this.logger.info(this.withTrace(meta), message);
    }

    warn(message: string, meta: Record<string, unknown>): void {
        this.logger.warn(this.withTrace(meta), message);
    }

    error(message: string, meta: Record<string, unknown>): void {
        this.logger.error(this.withTrace(meta), message);
    }

    /** Outside a request (boot, cron jobs) there is no trace, and nothing is added. */
    private withTrace(meta?: Record<string, unknown>): Record<string, unknown> {
        const context = this.context.get();
        if (!context?.traceId) return meta ?? {};

        return { traceId: context.traceId, spanId: context.spanId, ...meta };
    }
}
