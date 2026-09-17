import { env } from 'node:process';
import { parseJson } from '@common/utils';
import { isRecord } from '@shared';
import { z } from 'zod';

/** Supported engines */
export const DialectEnum = z.enum(['oracle', 'postgres', 'mysql', 'mariadb', 'mssql', 'sqlite']);

/** Common, engine-agnostic fields */
const BaseSource = z.object({
    key: z.string().min(1), // "core", "hr", ...
    dialect: DialectEnum, // discriminator
    poolMin: z.number().int().min(0).default(0),
    poolMax: z.number().int().min(1).default(10),
    defaultSchema: z.string().min(1).optional(),
    extra: z.record(z.string(), z.unknown()).optional(), // driver-specific knobs for non-oracle dialects
});

/** Helpers for “URL OR parts” validation */
const hasAll = <T extends Record<string, unknown>>(o: T, keys: (keyof T)[]) =>
    keys.every((k) => typeof o[k] === 'string' && String(o[k]).length > 0);

/**
 * Secrets can stay out of the JSON: `"passwordEnv": "CORE_DB_PASSWORD"` reads that env var.
 * Applied to every `<field>Env` pair listed here.
 */
const SECRET_ENV_FIELDS = ['password', 'walletPassword'] as const;

function resolveSecretRefs(source: unknown): unknown {
    if (!isRecord(source)) return source;
    const resolved: Record<string, unknown> = { ...source };
    for (const field of SECRET_ENV_FIELDS) {
        const ref = resolved[`${field}Env`];
        if (resolved[field] === undefined && typeof ref === 'string' && ref.length > 0) {
            resolved[field] = env[ref];
        }
    }
    return resolved;
}

const parseSources = (v: unknown, ctx: z.RefinementCtx) => {
    let parsed: unknown;
    try {
        parsed = parseJson<unknown>(v);
    } catch {
        // a thrown error would escape safeParse; report an issue without echoing the value
        ctx.addIssue({ code: 'custom', message: 'DATABASE_CONFIG_JSON is not valid JSON' });
        return z.NEVER;
    }
    const list = Array.isArray(parsed) ? parsed : isRecord(parsed) ? parsed.sources : parsed;
    return Array.isArray(list) ? list.map(resolveSecretRefs) : list;
};

//
// Oracle (fully implemented)
//

const OracleContextUser = z
    .object({
        /** Set CLIENT_IDENTIFIER per call when a context user is passed. */
        enabled: z.boolean().default(true),
        /** Reject calls without a context user (e.g. when VPD/audit depends on it). */
        required: z.boolean().default(false),
        /** Oracle CLIENT_IDENTIFIER max length is 64 bytes. */
        maxLength: z.number().int().min(1).max(64).default(64),
    })
    .default({ enabled: true, required: false, maxLength: 64 });

const OracleSource = BaseSource.extend({
    dialect: z.literal('oracle'),

    // --- target / auth ---
    /** oracle://user:password@host:port/service — alternative to connectString+user+password */
    connectionUrl: z.url().optional(),
    connectString: z.string().min(1).optional(),
    user: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    passwordEnv: z.string().min(1).optional(),
    externalAuth: z.boolean().default(false),
    edition: z.string().min(1).optional(),
    configDir: z.string().min(1).optional(), // tnsnames.ora / sqlnet.ora location
    walletLocation: z.string().min(1).optional(),
    walletPassword: z.string().min(1).optional(),
    walletPasswordEnv: z.string().min(1).optional(),
    sslServerDNMatch: z.boolean().optional(),
    httpsProxy: z.string().min(1).optional(),
    httpsProxyPort: z.number().int().min(1).max(65535).optional(),

    // --- pool ---
    poolMin: z.number().int().min(0).default(2),
    poolMax: z.number().int().min(1).default(10),
    poolIncrement: z.number().int().min(0).default(1),
    poolTimeoutSec: z.number().int().min(0).default(60), // idle connections above poolMin closed after
    poolMaxLifetimeSessionSec: z.number().int().min(0).default(0), // 0 = unlimited
    poolPingIntervalSec: z.number().int().default(60), // <0 disables, 0 = always ping
    poolPingTimeoutMs: z.number().int().min(0).default(5000),
    queueMax: z.number().int().min(-1).default(500), // -1 = unlimited
    queueTimeoutMs: z.number().int().min(0).default(60000),
    stmtCacheSize: z.number().int().min(0).default(30),
    enableStatistics: z.boolean().default(false),
    homogeneous: z.boolean().default(true),
    drainTimeSec: z.number().int().min(0).default(10), // graceful close on shutdown

    // --- network ---
    connectTimeoutSec: z.number().int().min(1).default(20),
    expireTimeMin: z.number().int().min(0).default(0), // keepalive probe for dead connections, 0 = off
    retryCount: z.number().int().min(0).default(0),
    retryDelaySec: z.number().int().min(0).default(1),
    callTimeoutMs: z.number().int().min(0).default(0), // default per round trip, 0 = none

    // --- fetch ---
    fetchArraySize: z.number().int().min(1).default(100),
    prefetchRows: z.number().int().min(0).default(2),
    maxRows: z.number().int().min(0).default(0), // 0 = unlimited
    outFormat: z.enum(['array', 'object']).default('array'),

    // --- behaviour ---
    slowQueryMs: z.number().int().min(0).default(1000), // 0 disables slow warnings
    logSql: z.boolean().default(false), // never logs bind values
    healthQuery: z.string().min(1).default('SELECT 1 FROM DUAL'),
    contextUser: OracleContextUser,
})
    .refine(
        (o) =>
            !!o.connectionUrl ||
            (o.externalAuth && hasAll(o, ['connectString'])) ||
            hasAll(o, ['connectString', 'user', 'password']),
        {
            message:
                'oracle: provide connectionUrl, connectString+user+password (or passwordEnv), or connectString with externalAuth',
        },
    )
    .refine((o) => o.poolMin <= o.poolMax, {
        message: 'oracle: poolMin must be <= poolMax',
        path: ['poolMin'],
    });

//
// Placeholders (schema only; clients throw UnsupportedDialectError until implemented)
//

const PostgresSource = BaseSource.extend({
    dialect: z.literal('postgres'),
    connectionUrl: z.url().optional(),
    host: z.string().optional(),
    port: z.number().int().min(1).optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    passwordEnv: z.string().min(1).optional(),
    ssl: z.boolean().optional(),
}).refine(
    (o) =>
        !!o.connectionUrl ||
        (hasAll(o, ['host', 'database', 'user', 'password']) && typeof o.port === 'number'),
    { message: 'postgres: provide either connectionUrl or host+port+database+user+password' },
);

const MySqlLike = {
    connectionUrl: z.url().optional(),
    host: z.string().optional(),
    port: z.number().int().min(1).optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    passwordEnv: z.string().min(1).optional(),
    ssl: z.boolean().optional(),
};

const MySqlSource = BaseSource.extend({
    dialect: z.literal('mysql'),
    ...MySqlLike,
}).refine(
    (o) =>
        !!o.connectionUrl ||
        (hasAll(o, ['host', 'database', 'user', 'password']) && typeof o.port === 'number'),
    { message: 'mysql: provide either connectionUrl or host+port+database+user+password' },
);

const MariaDbSource = BaseSource.extend({
    dialect: z.literal('mariadb'),
    ...MySqlLike,
}).refine(
    (o) =>
        !!o.connectionUrl ||
        (hasAll(o, ['host', 'database', 'user', 'password']) && typeof o.port === 'number'),
    { message: 'mariadb: provide either connectionUrl or host+port+database+user+password' },
);

const MsSqlSource = BaseSource.extend({
    dialect: z.literal('mssql'),
    connectionUrl: z.url().optional(),
    host: z.string().optional(),
    port: z.number().int().min(1).optional(),
    database: z.string().optional(),
    user: z.string().optional(),
    password: z.string().optional(),
    passwordEnv: z.string().min(1).optional(),
    encrypt: z.boolean().optional(),
}).refine(
    (o) =>
        !!o.connectionUrl ||
        (hasAll(o, ['host', 'database', 'user', 'password']) && typeof o.port === 'number'),
    { message: 'mssql: provide either connectionUrl or host+port+database+user+password' },
);

const SqliteSource = BaseSource.extend({
    dialect: z.literal('sqlite'),
    // Prefer file path; allow URL if you really want (e.g., "file:...").
    file: z.string().min(1).optional(),
    connectionUrl: z.url().optional(),
}).refine((o) => !!o.file || !!o.connectionUrl, {
    message: 'sqlite: provide a file path or a connectionUrl',
});

/** Process-wide node-oracledb settings (apply to every oracle source). */
export const oracleDriverSchema = z.object({
    /** Thick mode needs Oracle Instant Client; thin (default) needs nothing. */
    thickMode: z.boolean().default(false),
    clientLibDir: z.string().min(1).optional(),
    clientConfigDir: z.string().min(1).optional(),
    fetchAsString: z.array(z.enum(['CLOB', 'NCLOB', 'NUMBER', 'DATE', 'JSON'])).default([]),
    fetchAsBuffer: z.array(z.enum(['BLOB'])).default([]),
});

export const databaseConfigSchema = z.object({
    sources: z.preprocess(
        parseSources,
        z
            .array(
                z.discriminatedUnion('dialect', [
                    OracleSource,
                    PostgresSource,
                    MySqlSource,
                    MariaDbSource,
                    MsSqlSource,
                    SqliteSource,
                ]),
            )
            .min(1)
            .refine((sources) => new Set(sources.map((s) => s.key)).size === sources.length, {
                message: 'source keys must be unique',
            }),
    ),
    health: z.object({
        pingOnBoot: z.boolean().default(true),
        timeoutMs: z.coerce.number().int().min(0).max(60000).default(3000),
        maxRetries: z.coerce.number().int().min(0).max(100).default(2),
        requiredSources: z.array(z.string()).default([]),
        concurrency: z.coerce.number().int().min(1).max(100).default(3),
        jitterMs: z.coerce.number().int().min(0).max(5000).default(250),
    }),
    oracle: oracleDriverSchema.default({
        thickMode: false,
        fetchAsString: [],
        fetchAsBuffer: [],
    }),
    useDbLink: z.boolean().default(false),
});

// Typings
export type DatabaseConfig = z.infer<typeof databaseConfigSchema>;
export type DatabaseSource = DatabaseConfig['sources'][number];
export type OracleSourceConfig = Extract<DatabaseSource, { dialect: 'oracle' }>;
export type OracleDriverConfig = z.infer<typeof oracleDriverSchema>;
export type DatabaseHealth = DatabaseConfig['health'];
