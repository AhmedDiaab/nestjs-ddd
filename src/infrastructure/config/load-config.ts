import { env } from 'node:process';
import {
    appSchema,
    databaseConfigSchema,
    httpClientSchema,
    httpSchema,
    jwtSchema,
    loggingSchema,
    schedulerSchema,
} from '@infrastructure/config/schemas';
import { z } from 'zod';
import { envBool, envList, envString } from './env.util';
import { InvalidConfigError } from './invalid-config.error';

const rootSchema = z.object({
    app: appSchema,
    logging: loggingSchema,
    http: httpSchema,
    httpClient: httpClientSchema,
    // optional: services without a database leave DATABASE_CONFIG_JSON unset
    database: databaseConfigSchema.optional(),
    jwt: jwtSchema,
    scheduler: schedulerSchema,
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
        httpClient: {
            timeoutMs: envString(env.HTTP_CLIENT_TIMEOUT_MS),
            retries: envString(env.HTTP_CLIENT_RETRIES),
            retryBaseMs: envString(env.HTTP_CLIENT_RETRY_BASE_MS),
            retryJitterMs: envString(env.HTTP_CLIENT_RETRY_JITTER_MS),
            retryMaxDelayMs: envString(env.HTTP_CLIENT_RETRY_MAX_DELAY_MS),
            circuitEnabled: envBool(env.HTTP_CLIENT_CIRCUIT_ENABLED),
            circuitFailureThreshold: envString(env.HTTP_CLIENT_CIRCUIT_FAILURE_THRESHOLD),
            circuitResetMs: envString(env.HTTP_CLIENT_CIRCUIT_RESET_MS),
            userAgent: envString(env.HTTP_CLIENT_USER_AGENT),
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
        scheduler: {
            enabled: envBool(env.SCHEDULER_ENABLED),
            timezone: envString(env.SCHEDULER_TIMEZONE),
        },
    };
}

export type AppConfig = z.infer<typeof rootSchema>;

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
