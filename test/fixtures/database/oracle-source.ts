import { databaseConfigSchema, type OracleSourceConfig } from '@infrastructure/config/schemas';

/** Builds a fully-defaulted oracle source the same way config loading does. */
export function oracleSource(overrides: Record<string, unknown> = {}): OracleSourceConfig {
    const config = databaseConfigSchema.parse({
        sources: [
            {
                key: 'main',
                dialect: 'oracle',
                connectString: 'localhost:1521/FREEPDB1',
                user: 'app',
                password: 'secret',
                ...overrides,
            },
        ],
        health: {},
    });
    return config.sources[0] as OracleSourceConfig;
}
