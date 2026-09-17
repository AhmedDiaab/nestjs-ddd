import type { LogMeta } from '@application/shared';

export interface LoggerPort {
    debug(message: string, meta?: LogMeta): void;
    info(message: string, meta: LogMeta): void;
    warn(message: string, meta: LogMeta): void;
    error(message: string, meta: LogMeta): void;
}
