import { LoggerPort } from '@application/ports';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

@Injectable()
export class PinoLoggerAdapter implements LoggerPort {
    constructor(private readonly logger: PinoLogger) {}

    debug(message: string, meta?: Record<string, unknown>): void {
        this.logger.debug(message, meta);
    }

    info(message: string, meta: Record<string, unknown>): void {
        this.logger.info(message, meta);
    }

    warn(message: string, meta: Record<string, unknown>): void {
        this.logger.warn(message, meta);
    }

    error(message: string, meta: Record<string, unknown>): void {
        this.logger.error(message, meta);
    }
}
