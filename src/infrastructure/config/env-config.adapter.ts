import { env } from 'node:process';
import type { ConfigKey, ConfigPort, ConfigValue, ConfigValues } from '@application/ports';
import { isRecord } from '@shared';
import { config } from 'dotenv-flow';
import { loadConfig, type AppConfig } from './load-config';

export class EnvConfigAdapter implements ConfigPort {
    private readonly config: AppConfig;

    /**
     * `config` lets a caller that already validated one (e.g. `main.ts`'s early TLS read, which
     * must run before Nest — and therefore DI — exists) reuse it instead of parsing env twice.
     * Omitted, this validates from `process.env` itself, as every DI-constructed instance does.
     */
    constructor(config?: AppConfig) {
        this.loadEnv();
        this.config = config ?? loadConfig();
    }

    private loadEnv(): void {
        if (['test', 'testing'].includes(env.NODE_ENV as string)) return;
        config({ silent: true });
    }

    isDevelopment(): boolean {
        return this.config.app.env === 'development';
    }

    isProduction(): boolean {
        return this.config.app.env === 'production';
    }

    /** Dot-path access, typed by `ConfigValues` (see `config-values.ts`): `get('http.port')`. */
    get<K extends ConfigKey>(key: K): ConfigValue<K> {
        let current: unknown = this.config;

        for (const part of key.split('.')) {
            if (!isRecord(current)) return undefined as ConfigValue<K>;
            current = current[part];
            if (current === undefined) return undefined as ConfigValue<K>;
        }
        return current as ConfigValue<K>;
    }

    all(): ConfigValues {
        return structuredClone(this.config);
    }
}
