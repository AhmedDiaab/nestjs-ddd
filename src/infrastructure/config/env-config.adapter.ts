import { env } from 'node:process';
import 'dotenv-flow/config';
import type { ConfigPort } from '@application/ports/config.port';
import { isRecord } from '@shared/helpers';
import { z } from 'zod';
import { appSchema } from './schemas/app.schema';
import { httpSchema } from './schemas/http.schema';
import { loggingSchema } from './schemas/logging.schema';

const rootSchema = z
    .object({
        app: appSchema,
        logging: loggingSchema,
        http: httpSchema,
    })
    .transform((v) => v);

// hydrate from process.env once, then validate
function hydrate() {
    // Map flat env → namespaced objects
    return {
        app: {
            env: env.NODE_ENV,
        },
        logging: {
            logLevel: env.LOG_LEVEL,
            showStackTraces: env.SHOW_STACK_TRACES === 'true',
            requestIdHeader: env.REQUEST_ID_HEADER,
            toFile: env.LOGGING_TO_FILE === 'true',
            directory: env.LOGGING_DIR,
            fileName: env.LOGGING_FILE_NAME,
            filesLimit: parseInt(env.LOGGING_FILES_LIMIT || ''),
            maxSize: env.LOGGING_MAX_SIZE,
        },
        http: {
            port: env.PORT,
            origins: env.CORS_ORIGINS,
            serverTimeout: env.SERVER_TIMEOUT,
            headersTimeout: env.HEADERS_TIMEOUT,
            keepAliveTimeout: env.KEEP_ALIVE_TIMEOUT,
            jsonBodyLimit: env.JSON_BODY_LIMIT,
            urlencodedBodyLimit: env.URLENCODED_BODY_LIMIT,
        },
    };
}

export type AppConfig = z.infer<typeof rootSchema>;

export class EnvConfigAdapter implements ConfigPort {
    private readonly config: AppConfig;

    constructor() {
        const parsed = rootSchema.safeParse(hydrate());
        if (!parsed.success) {
            const errs = parsed.error.issues.map((i) => ({
                path: i.path.join('.') || '(root)',
                code: i.code,
                message: i.message,
            }));
            // Do NOT print env values
            console.error('❌ Invalid configuration:', errs);
            process.exit(1);
        }
        this.config = parsed.data;
    }

    isDevelopment(): boolean {
        return this.config.app.env === 'development';
    }

    // dot-path access: e.g., get<number>('http.PORT')
    get<T = unknown>(key: string): T | undefined {
        const parts = key.split('.');
        let current: unknown = this.config;

        for (const part of parts) {
            if (!isRecord(current)) return undefined;
            current = current[part];
            if (current === undefined) return undefined;
        }
        return current as T;
    }

    all(): Record<string, unknown> {
        return { ...this.config };
    }
}
