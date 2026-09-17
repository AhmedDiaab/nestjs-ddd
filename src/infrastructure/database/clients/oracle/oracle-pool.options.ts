import type { OracleSourceConfig } from '@infrastructure/config/schemas';
import oracledb, { type ExecuteOptions, type PoolAttributes } from 'oracledb';

type Credentials = Pick<PoolAttributes, 'user' | 'password' | 'connectString'>;

/** oracle://user:password@host:1521/service → node-oracledb credentials (Easy Connect). */
export function parseOracleUrl(url: string): Credentials {
    const parsed = new URL(url);
    const service = parsed.pathname.replace(/^\//, '');
    const port = parsed.port || '1521';
    return {
        user: decodeURIComponent(parsed.username) || undefined,
        password: decodeURIComponent(parsed.password) || undefined,
        connectString: `${parsed.hostname}:${port}/${service}${parsed.search}`,
    };
}

/** Pure mapping from validated source config to `oracledb.createPool` attributes. */
export function toPoolAttributes(source: OracleSourceConfig): PoolAttributes {
    const credentials: Credentials = source.connectionUrl
        ? parseOracleUrl(source.connectionUrl)
        : {};

    return {
        poolAlias: source.key,

        user: source.externalAuth ? undefined : (source.user ?? credentials.user),
        password: source.externalAuth ? undefined : (source.password ?? credentials.password),
        connectString: source.connectString ?? credentials.connectString,
        externalAuth: source.externalAuth,
        edition: source.edition,
        configDir: source.configDir,
        walletLocation: source.walletLocation,
        walletPassword: source.walletPassword,
        sslServerDNMatch: source.sslServerDNMatch,
        httpsProxy: source.httpsProxy,
        httpsProxyPort: source.httpsProxyPort,

        poolMin: source.poolMin,
        poolMax: source.poolMax,
        poolIncrement: source.poolIncrement,
        poolTimeout: source.poolTimeoutSec,
        maxLifetimeSession: source.poolMaxLifetimeSessionSec,
        poolPingInterval: source.poolPingIntervalSec,
        poolPingTimeout: source.poolPingTimeoutMs,
        queueMax: source.queueMax,
        queueTimeout: source.queueTimeoutMs,
        stmtCacheSize: source.stmtCacheSize,
        enableStatistics: source.enableStatistics,
        homogeneous: source.homogeneous,

        connectTimeout: source.connectTimeoutSec,
        transportConnectTimeout: source.connectTimeoutSec,
        expireTime: source.expireTimeMin,
        retryCount: source.retryCount,
        retryDelay: source.retryDelaySec,
    };
}

/** Per-source execute defaults; spread into `connection.execute(sql, binds, { ...defaults })`. */
export function toExecuteDefaults(source: OracleSourceConfig): ExecuteOptions {
    return {
        fetchArraySize: source.fetchArraySize,
        prefetchRows: source.prefetchRows,
        maxRows: source.maxRows,
        outFormat:
            source.outFormat === 'object' ? oracledb.OUT_FORMAT_OBJECT : oracledb.OUT_FORMAT_ARRAY,
    };
}
