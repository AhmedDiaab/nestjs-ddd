import { createToken } from '@shared';
import type { ConfigPort } from './config.port';
import type { LoggerPort } from './logger.port';
import type { DatabaseInfoRepositoryPort } from './repositories';

/**
 * DI tokens for application ports. Interfaces vanish at runtime, so Nest needs a value to
 * inject by. Tokens live next to the ports so use cases never import infrastructure.
 * Each token carries its port type: binding an adapter that doesn't implement it fails to compile.
 */
export const ConfigPortToken = createToken<ConfigPort>('ConfigPort');

export const LoggerPortToken = createToken<LoggerPort>('LoggerPort');

export const DatabaseInfoRepositoryPortToken = createToken<DatabaseInfoRepositoryPort>(
    'DatabaseInfoRepositoryPort',
);
