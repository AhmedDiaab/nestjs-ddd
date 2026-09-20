import { InvalidConfigError, loadConfig } from '@infrastructure/config';
import { config as dotenvFlow } from 'dotenv-flow';

jest.mock('dotenv-flow', () => ({ config: jest.fn() }));

const readEnvFiles = dotenvFlow as jest.MockedFunction<typeof dotenvFlow>;

const BASE_ENV = {
    NODE_ENV: 'test',
    JWT_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
    const original = process.env;

    beforeEach(() => {
        process.env = { ...BASE_ENV };
        readEnvFiles.mockClear();
    });

    afterAll(() => {
        process.env = original;
    });

    // `main.ts` calls loadConfig() before Nest exists, to build httpsOptions. Reading the env
    // file has to happen here rather than in EnvConfigAdapter, or that earlier caller parses a
    // bare environment and a deployment whose secrets live in .env.<NODE_ENV> dies at boot.
    it('reads the env file before validating, outside test environments', () => {
        // Arrange
        process.env = { ...BASE_ENV, NODE_ENV: 'production' };

        // Act
        loadConfig();

        // Assert
        expect(readEnvFiles).toHaveBeenCalledTimes(1);
    });

    it('leaves the env file alone under test, where specs set process.env themselves', () => {
        // Arrange: BASE_ENV already sets NODE_ENV to test

        // Act
        loadConfig();

        // Assert
        expect(readEnvFiles).not.toHaveBeenCalled();
    });

    it('applies schema defaults when env values are unset', () => {
        // Arrange: only BASE_ENV is set

        // Act
        const config = loadConfig();

        // Assert
        expect(config.logging.toFile).toBe(true); // was false before: "=== 'true'" on undefined
        expect(config.logging.filesLimit).toBe(14); // was NaN before: parseInt('')
        expect(config.http.corsOrigins).toEqual([]);
        expect(config.database).toBeUndefined();
    });

    it('parses booleans, numbers and lists from env strings', () => {
        // Arrange
        process.env = {
            ...BASE_ENV,
            LOGGING_TO_FILE: 'false',
            LOGGING_FILES_LIMIT: '7',
            CORS_ORIGINS: 'https://a.example, https://b.example',
        };

        // Act
        const config = loadConfig();

        // Assert
        expect(config.logging.toFile).toBe(false);
        expect(config.logging.filesLimit).toBe(7);
        expect(config.http.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
    });

    it('loads database config with health list and oracle driver options', () => {
        // Arrange
        process.env = {
            ...BASE_ENV,
            DATABASE_CONFIG_JSON: JSON.stringify([
                { key: 'main', dialect: 'oracle', connectString: 'h/s', user: 'u', password: 'p' },
            ]),
            DATABASE_PING_REQUIRED_SOURCES: 'main',
            ORACLE_FETCH_AS_STRING: 'clob,number',
        };

        // Act
        const config = loadConfig();

        // Assert
        expect(config.database?.health).toMatchObject({
            pingOnBoot: true,
            requiredSources: ['main'],
        });
        expect(config.database?.oracle.fetchAsString).toEqual(['CLOB', 'NUMBER']);
    });

    it('loads TLS config from env, defaulting to disabled', () => {
        // Arrange: only BASE_ENV is set

        // Act
        const config = loadConfig();

        // Assert
        expect(config.tls).toMatchObject({ enabled: false, minVersion: 'TLSv1.2' });
    });

    it('loads cluster config from env, defaulting to disabled', () => {
        // Arrange: only BASE_ENV is set

        // Act
        const config = loadConfig();

        // Assert
        expect(config.cluster).toMatchObject({
            enabled: false,
            workers: 0,
            respawn: true,
            isLeader: false,
        });
    });

    it('parses cluster overrides from env', () => {
        // Arrange
        process.env = {
            ...BASE_ENV,
            CLUSTER_ENABLED: 'true',
            CLUSTER_WORKERS: '4',
            CLUSTER_RESPAWN: 'false',
            CLUSTER_RESPAWN_MAX_PER_MINUTE: '5',
            CLUSTER_METRICS_PORT: '9091',
        };

        // Act
        const config = loadConfig();

        // Assert
        expect(config.cluster).toMatchObject({
            enabled: true,
            workers: 4,
            respawn: false,
            respawnMaxPerMinute: 5,
            metricsPort: 9091,
        });
    });

    it('loads legacy config from env, defaulting to disabled', () => {
        // Arrange: only BASE_ENV is set

        // Act
        const config = loadConfig();

        // Assert
        expect(config.legacy).toMatchObject({
            forwardEnabled: false,
            forwardPrefixes: [],
            preserveHostHeader: false,
        });
    });

    it('parses legacy overrides from env', () => {
        // Arrange
        process.env = {
            ...BASE_ENV,
            LEGACY_FORWARD_ENABLED: 'true',
            LEGACY_TARGET_URL: 'http://legacy-host:8080',
            LEGACY_FORWARD_PREFIXES: '/v1/orders, /v1/invoices',
            LEGACY_TIMEOUT_MS: '2000',
            LEGACY_PRESERVE_HOST_HEADER: 'true',
        };

        // Act
        const config = loadConfig();

        // Assert
        expect(config.legacy).toMatchObject({
            forwardEnabled: true,
            targetUrl: 'http://legacy-host:8080',
            forwardPrefixes: ['/v1/orders', '/v1/invoices'],
            timeoutMs: 2000,
            preserveHostHeader: true,
        });
    });

    it('requires LEGACY_TARGET_URL and LEGACY_FORWARD_PREFIXES when LEGACY_FORWARD_ENABLED=true', () => {
        // Arrange
        process.env = { ...BASE_ENV, LEGACY_FORWARD_ENABLED: 'true' };

        // Act
        let error: unknown;
        try {
            loadConfig();
        } catch (e) {
            error = e;
        }

        // Assert
        expect(error).toBeInstanceOf(InvalidConfigError);
        expect((error as Error).message).toContain('LEGACY_TARGET_URL');
        expect((error as Error).message).toContain('LEGACY_FORWARD_PREFIXES');
    });

    it('requires TLS_KEY_FILE and TLS_CERT_FILE when TLS_ENABLED=true', () => {
        // Arrange
        process.env = { ...BASE_ENV, TLS_ENABLED: 'true' };

        // Act
        let error: unknown;
        try {
            loadConfig();
        } catch (e) {
            error = e;
        }

        // Assert
        expect(error).toBeInstanceOf(InvalidConfigError);
        expect((error as Error).message).toContain('TLS_KEY_FILE');
        expect((error as Error).message).toContain('TLS_CERT_FILE');
    });

    it('never includes secret values in validation errors', () => {
        // Arrange
        process.env = {
            ...BASE_ENV,
            JWT_SECRET: 'short-secret-value',
            DATABASE_CONFIG_JSON:
                '{"sources": [{"key":"main","dialect":"oracle","password":"TopSecret!"',
        };

        // Act
        let error: unknown;
        try {
            loadConfig();
        } catch (e) {
            error = e;
        }

        // Assert
        expect(error).toBeInstanceOf(InvalidConfigError);
        const text = `${(error as Error).message} ${JSON.stringify((error as InvalidConfigError).issues)}`;
        expect(text).not.toContain('TopSecret');
        expect(text).not.toContain('short-secret-value');
    });
});
