/**
 * DI tokens for application ports.
 * Tokens live next to the ports so application/interface layers never import infrastructure.
 */
export const ConfigPortToken = Symbol.for('ConfigPort');

export const LoggerPortToken = Symbol.for('LoggerPort');

export const DatabaseInfoRepositoryPortToken = Symbol.for('DatabaseInfoRepositoryPort');
