import { env } from 'node:process';
import type { ConfigKey, ConfigPort, ConfigValue, ConfigValues } from '@application/ports';
import {
    appSchema,
    databaseConfigSchema,
    httpSchema,
    jwtSchema,
    loggingSchema,
} from '@infrastructure/config/schemas';
import { isRecord } from '@shared';
import { config } from 'dotenv-flow';
import { z } from 'zod';
import { envBool, envList, envString } from './env.util';

const rootSchema = z.object({
    app: appSchema,
    logging: loggingSchema,
    http: httpSchema,
    // optional: services without a database leave DATABASE_CONFIG_JSON unset
    database: databaseConfigSchema.optional(),
    jwt: jwtSchema,
});

// hydrate from process.env once, then validate
function hydrate() {
    const databaseSources = envString(env.DATABASE_CONFIG_JSON);

    // Map flat env → namespaced objects
    return {
        app: {
            env: envString(env.NODE_ENV),
        },
        logging: {
            logLevel: envString(env.LOG_LEVEL),
            showStackTraces: envBool(env.SHOW_STACK_TRACES),
            requestIdHeader: envString(env.REQUEST_ID_HEADER),
            toFile: envBool(env.LOGGING_TO_FILE),
            directory: envString(env.LOGGING_DIR),
            fileName: envString(env.LOGGING_FILE_NAME),
            filesLimit: envString(env.LOGGING_FILES_LIMIT),
            maxSize: envString(env.LOGGING_MAX_SIZE),
            pretty: envBool(env.LOGGING_PRETTY),
        },
        http: {
            port: envString(env.PORT),
            corsOrigins: envList(env.CORS_ORIGINS),
            serverTimeout: envString(env.SERVER_TIMEOUT),
            headersTimeout: envString(env.HEADERS_TIMEOUT),
            keepAliveTimeout: envString(env.KEEP_ALIVE_TIMEOUT),
            jsonBodyLimit: envString(env.JSON_BODY_LIMIT),
            urlencodedBodyLimit: envString(env.URLENCODED_BODY_LIMIT),
            swaggerEnabled: envBool(env.SWAGGER_ENABLED),
            throttleTtlMs: envString(env.THROTTLE_TTL_MS),
            throttleLimit: envString(env.THROTTLE_LIMIT),
            throttleStorage: envString(env.THROTTLE_STORAGE),
            throttleRedisUrl: envString(env.THROTTLE_REDIS_URL),
            trustProxy: envBool(env.TRUST_PROXY),
            csrfEnabled: envBool(env.CSRF_ENABLED),
            csrfTrustedOrigins: envList(env.CSRF_TRUSTED_ORIGINS),
        },
        database: databaseSources
            ? {
                  sources: databaseSources,
                  health: {
                      pingOnBoot: envBool(env.DATABASE_PING_ON_BOOT),
                      timeoutMs: envString(env.DATABASE_PING_TIMEOUT_MS),
                      maxRetries: envString(env.DATABASE_PING_MAX_RETRIES),
                      // "core,analytics" → ["core", "analytics"]
                      requiredSources: envList(env.DATABASE_PING_REQUIRED_SOURCES),
                      concurrency: envString(env.DATABASE_PING_CONCURRENCY),
                      jitterMs: envString(env.DATABASE_PING_JITTER_MS),
                  },
                  oracle: {
                      thickMode: envBool(env.ORACLE_THICK_MODE),
                      clientLibDir: envString(env.ORACLE_CLIENT_LIB_DIR),
                      clientConfigDir: envString(env.ORACLE_CLIENT_CONFIG_DIR),
                      fetchAsString: envList(env.ORACLE_FETCH_AS_STRING)?.map((t) =>
                          t.toUpperCase(),
                      ),
                      fetchAsBuffer: envList(env.ORACLE_FETCH_AS_BUFFER)?.map((t) =>
                          t.toUpperCase(),
                      ),
                  },
                  useDbLink: envBool(env.DATABASE_USE_DBLINK),
              }
            : undefined,
        jwt: {
            secret: envString(env.JWT_SECRET),
            algorithms: envList(env.JWT_ALGORITHMS),
            issuer: envString(env.JWT_ISSUER),
            audience: envString(env.JWT_AUDIENCE),
            cookieName: envString(env.JWT_COOKIE_NAME),
        },
    };
}

export type AppConfig = z.infer<typeof rootSchema>;

export class InvalidConfigError extends Error {
    constructor(public readonly issues: { path: string; code: string; message: string }[]) {
        super(
            `Invalid configuration:\n${issues.map((i) => `  - ${i.path}: ${i.message}`).join('\n')}`,
        );
        this.name = 'InvalidConfigError';
    }
}

/** Validates env into a typed config. Values are never included in errors (they may be secrets). */
export function loadConfig(): AppConfig {
    const parsed = rootSchema.safeParse(hydrate());
    if (!parsed.success) {
        throw new InvalidConfigError(
            parsed.error.issues.map((i) => ({
                path: i.path.join('.') || '(root)',
                code: i.code,
                message: i.message,
            })),
        );
    }
    return parsed.data;
}

export class EnvConfigAdapter implements ConfigPort {
    private readonly config: AppConfig;

    constructor() {
        this.loadEnv();
        this.config = loadConfig();
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
