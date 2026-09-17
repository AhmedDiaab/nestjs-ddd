import type { ConfigPort } from '@application/ports';
import { InvalidConfigError, loadConfig } from '@infrastructure/config';
import { createThrottlerStorage } from '@infrastructure/throttling';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

const configWith = (values: Record<string, unknown>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigPort;

describe('createThrottlerStorage', () => {
    it('keeps the in-memory default when storage is memory', () => {
        // Arrange
        const config = configWith({ 'http.throttleStorage': 'memory' });

        // Act
        const storage = createThrottlerStorage(config);

        // Assert
        expect(storage).toBeNull();
    });

    it('creates a Redis-backed storage when storage is redis', () => {
        // Arrange
        const config = configWith({
            'http.throttleStorage': 'redis',
            'http.throttleRedisUrl': 'redis://localhost:6399/0',
        });

        // Act
        const storage = createThrottlerStorage(config, { lazyConnect: true });

        // Assert
        expect(storage).toBeInstanceOf(ThrottlerStorageRedisService);
        (storage as ThrottlerStorageRedisService).onModuleDestroy(); // no socket was opened
    });
});

describe('throttle storage config', () => {
    const original = process.env;

    afterEach(() => {
        process.env = original;
    });

    it('requires THROTTLE_REDIS_URL when THROTTLE_STORAGE=redis', () => {
        // Arrange
        process.env = { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(32), THROTTLE_STORAGE: 'redis' };

        // Act
        let error: unknown;
        try {
            loadConfig();
        } catch (e) {
            error = e;
        }

        // Assert
        expect(error).toBeInstanceOf(InvalidConfigError);
        expect((error as InvalidConfigError).issues).toEqual([
            expect.objectContaining({ path: 'http.throttleRedisUrl' }),
        ]);
    });

    it('defaults to memory storage', () => {
        // Arrange
        process.env = { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(32) };

        // Act
        const config = loadConfig();

        // Assert
        expect(config.http.throttleStorage).toBe('memory');
    });
});
