import { InvalidConfigError, loadConfig } from '@infrastructure/config';

const BASE_ENV = {
    NODE_ENV: 'test',
    JWT_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
    const original = process.env;

    beforeEach(() => {
        process.env = { ...BASE_ENV };
    });

    afterAll(() => {
        process.env = original;
    });

    it('applies schema defaults when env values are unset', () => {
        const config = loadConfig();

        expect(config.logging.toFile).toBe(true); // was false before: "=== 'true'" on undefined
        expect(config.logging.filesLimit).toBe(14); // was NaN before: parseInt('')
        expect(config.http.corsOrigins).toEqual([]);
        expect(config.database).toBeUndefined();
    });

    it('parses booleans, numbers and lists from env strings', () => {
        process.env = {
            ...BASE_ENV,
            LOGGING_TO_FILE: 'false',
            LOGGING_FILES_LIMIT: '7',
            CORS_ORIGINS: 'https://a.example, https://b.example',
        };

        const config = loadConfig();

        expect(config.logging.toFile).toBe(false);
        expect(config.logging.filesLimit).toBe(7);
        expect(config.http.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
    });

    it('loads database config with health list and oracle driver options', () => {
        process.env = {
            ...BASE_ENV,
            DATABASE_CONFIG_JSON: JSON.stringify([
                { key: 'main', dialect: 'oracle', connectString: 'h/s', user: 'u', password: 'p' },
            ]),
            DATABASE_PING_REQUIRED_SOURCES: 'main',
            ORACLE_FETCH_AS_STRING: 'clob,number',
        };

        const config = loadConfig();

        expect(config.database?.health).toMatchObject({
            pingOnBoot: true,
            requiredSources: ['main'],
        });
        expect(config.database?.oracle.fetchAsString).toEqual(['CLOB', 'NUMBER']);
    });

    it('never includes secret values in validation errors', () => {
        process.env = {
            ...BASE_ENV,
            JWT_SECRET: 'short-secret-value',
            DATABASE_CONFIG_JSON:
                '{"sources": [{"key":"main","dialect":"oracle","password":"TopSecret!"',
        };

        let error: unknown;
        try {
            loadConfig();
        } catch (e) {
            error = e;
        }

        expect(error).toBeInstanceOf(InvalidConfigError);
        const text = `${(error as Error).message} ${JSON.stringify((error as InvalidConfigError).issues)}`;
        expect(text).not.toContain('TopSecret');
        expect(text).not.toContain('short-secret-value');
    });
});
