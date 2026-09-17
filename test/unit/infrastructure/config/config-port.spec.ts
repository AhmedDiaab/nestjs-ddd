import type { ConfigPort } from '@application/ports';
import { EnvConfigAdapter } from '@infrastructure/config';

describe('ConfigPort typed keys (types checked by `pnpm typecheck`)', () => {
    const original = process.env;
    let config: ConfigPort;

    beforeAll(() => {
        process.env = { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(32), PORT: '4100' };
        config = new EnvConfigAdapter();
    });

    afterAll(() => {
        process.env = original;
    });

    it('returns the value at a dot path with its schema type', () => {
        // Arrange
        const key = 'http.port';

        // Act
        const port: number = config.get(key);

        // Assert
        expect(port).toBe(4100);
    });

    it('returns whole sections', () => {
        // Arrange
        const key = 'logging';

        // Act
        const logging = config.get(key);

        // Assert
        expect(logging.filesLimit).toBe(14);
    });

    it('types values under an optional section as possibly undefined', () => {
        // Arrange: no DATABASE_CONFIG_JSON, so the database section is absent

        // Act
        const timeoutMs: number | undefined = config.get('database.health.timeoutMs');

        // Assert
        expect(timeoutMs).toBeUndefined();
    });

    it('rejects unknown keys and wrong value types at compile time', () => {
        // Arrange: each line below is a compile error, verified by `pnpm typecheck`

        // Act
        const misuse = [
            // @ts-expect-error unknown key
            () => config.get('http.prot'),
            // @ts-expect-error http.port is a number
            (): string => config.get('http.port'),
            // @ts-expect-error database is optional, so its values may be undefined
            (): number => config.get('database.health.timeoutMs'),
        ];

        // Assert
        expect(misuse).toHaveLength(3);
    });
});
