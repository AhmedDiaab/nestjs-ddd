import type { AppConfig } from './load-config';

/**
 * Gives `ConfigPort.get` its keys and value types: the application port declares an empty
 * `ConfigValues` and this merges the validated config shape into it (types only, no runtime link).
 */
declare module '@application/ports/config.port' {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging
    interface ConfigValues extends AppConfig {}
}
