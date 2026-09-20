import type { ConfigPort, LoggerPort } from '@application/ports';
import pino from 'pino';
import { createTransportTargets } from './pino.options';

/**
 * A `LoggerPort` backed by plain pino — no `nestjs-pino`, no request context, no DI — for code
 * that runs before Nest exists. Today that is only the cluster primary
 * (`src/infrastructure/cluster`), which never builds a Nest application. Same level and
 * transport (console + optional file rotation) as the in-app logger, built from the same
 * `createTransportTargets`; there is no request here, so trace/span fields are simply absent.
 */
export class PinoProcessLogger implements LoggerPort {
    private readonly logger: pino.Logger;

    constructor(config: ConfigPort) {
        this.logger = pino({
            level: config.get('logging.logLevel'),
            base: { pid: process.pid },
            transport: { targets: createTransportTargets(config) },
        });
    }

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
