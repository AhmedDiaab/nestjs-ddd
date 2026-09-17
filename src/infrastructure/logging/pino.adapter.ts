import { LoggerPort } from '@application/ports';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

/**
 * `PinoLogger` takes the merged object **first** and the message second. Passing the meta as a
 * second argument matches its `(msg, ...args)` overload instead, and the fields are dropped:
 * the line still prints, so the loss is invisible until someone looks for a field in production.
 */
@Injectable()
export class PinoLoggerAdapter implements LoggerPort {
    constructor(private readonly logger: PinoLogger) {}

    debug(message: string, meta?: Record<string, unknown>): void {
        this.logger.debug(meta ?? {}, message);
    }

    info(message: string, meta: Record<string, unknown>): void {
        this.logger.info(meta, message);
    }

    warn(message: string, meta: Record<string, unknown>): void {
        this.logger.warn(meta, message);
    }

    error(message: string, meta: Record<string, unknown>): void {
        this.logger.error(meta, message);
    }
}
