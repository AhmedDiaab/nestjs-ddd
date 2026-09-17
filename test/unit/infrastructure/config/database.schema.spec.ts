import { databaseConfigSchema } from '@infrastructure/config/schemas';

const oracle = { key: 'main', dialect: 'oracle', connectString: 'h/s', user: 'u', password: 'p' };

describe('databaseConfigSchema', () => {
    afterEach(() => {
        delete process.env.TEST_DB_PASSWORD;
    });

    it('parses JSON sources and applies oracle defaults', () => {
        const parsed = databaseConfigSchema.parse({
            sources: JSON.stringify([oracle]),
            health: {},
        });

        expect(parsed.sources[0]).toMatchObject({
            poolMin: 2,
            poolMax: 10,
            queueTimeoutMs: 60000,
            stmtCacheSize: 30,
            contextUser: { enabled: true, required: false, maxLength: 64 },
        });
        expect(parsed.health.pingOnBoot).toBe(true);
        expect(parsed.oracle.thickMode).toBe(false);
    });

    it('accepts the { sources: [...] } wrapper form', () => {
        const parsed = databaseConfigSchema.parse({
            sources: JSON.stringify({ sources: [oracle] }),
            health: {},
        });
        expect(parsed.sources).toHaveLength(1);
    });

    it('resolves passwordEnv from the environment', () => {
        process.env.TEST_DB_PASSWORD = 'from-env';
        const { password: _omit, ...withoutPassword } = oracle;
        void _omit;

        const parsed = databaseConfigSchema.parse({
            sources: [{ ...withoutPassword, passwordEnv: 'TEST_DB_PASSWORD' }],
            health: {},
        });

        expect(parsed.sources[0]).toMatchObject({ password: 'from-env' });
    });

    it('rejects oracle sources without credentials', () => {
        const result = databaseConfigSchema.safeParse({
            sources: [{ key: 'main', dialect: 'oracle', connectString: 'h/s' }],
            health: {},
        });
        expect(result.success).toBe(false);
    });

    it('rejects poolMin greater than poolMax', () => {
        const result = databaseConfigSchema.safeParse({
            sources: [{ ...oracle, poolMin: 20, poolMax: 5 }],
            health: {},
        });
        expect(result.success).toBe(false);
    });

    it('rejects duplicate source keys', () => {
        const result = databaseConfigSchema.safeParse({ sources: [oracle, oracle], health: {} });
        expect(result.success).toBe(false);
    });

    it('still validates placeholder dialects', () => {
        const ok = databaseConfigSchema.safeParse({
            sources: [{ key: 'pg', dialect: 'postgres', connectionUrl: 'postgres://u:p@h:5432/d' }],
            health: {},
        });
        const bad = databaseConfigSchema.safeParse({
            sources: [{ key: 'pg', dialect: 'postgres' }],
            health: {},
        });
        expect(ok.success).toBe(true);
        expect(bad.success).toBe(false);
    });
});
