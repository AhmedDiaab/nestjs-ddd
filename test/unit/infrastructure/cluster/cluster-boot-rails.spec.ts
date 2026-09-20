import type { LoggerPort } from '@application/ports';
import { runClusterBootRails, type ClusterBootRailsConfig } from '@infrastructure/cluster';
import { InvalidConfigError } from '@infrastructure/config';

describe('runClusterBootRails', () => {
    const debug = jest.fn();
    const info = jest.fn();
    const warn = jest.fn();
    const error = jest.fn();
    const logger: LoggerPort = { debug, info, warn, error };

    const baseConfig = (): ClusterBootRailsConfig => ({
        idempotency: { store: 'oracle' },
        http: { throttleStorage: 'redis', throttleLimit: 100 },
    });

    afterEach(() => jest.clearAllMocks());

    it('fails fast when IDEMPOTENCY_STORE=memory with more than one worker', () => {
        // Arrange
        const config: ClusterBootRailsConfig = {
            ...baseConfig(),
            idempotency: { store: 'memory' },
        };

        // Act
        const act = () => runClusterBootRails(config, 3, logger);

        // Assert
        expect(act).toThrow(InvalidConfigError);
        expect(act).toThrow(/IDEMPOTENCY_STORE/);
    });

    it('boots a single worker fine with IDEMPOTENCY_STORE=memory', () => {
        // Arrange
        const config: ClusterBootRailsConfig = {
            ...baseConfig(),
            idempotency: { store: 'memory' },
        };

        // Act
        const act = () => runClusterBootRails(config, 1, logger);

        // Assert
        expect(act).not.toThrow();
    });

    it('warns once when THROTTLE_STORAGE=memory with more than one worker, naming the effective limit', () => {
        // Arrange
        const config: ClusterBootRailsConfig = {
            ...baseConfig(),
            http: { throttleStorage: 'memory', throttleLimit: 50 },
        };

        // Act
        runClusterBootRails(config, 4, logger);

        // Assert
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            'cluster.throttle.memory',
            expect.objectContaining({ limitPerWorker: 50, workers: 4, effectiveLimit: 200 }),
        );
    });

    it('does neither the memory-idempotency throw nor the throttle warning for a single worker', () => {
        // Arrange
        const config: ClusterBootRailsConfig = {
            idempotency: { store: 'memory' },
            http: { throttleStorage: 'memory', throttleLimit: 50 },
        };

        // Act
        const act = () => runClusterBootRails(config, 1, logger);

        // Assert
        expect(act).not.toThrow();
        expect(warn).not.toHaveBeenCalled();
    });

    it('logs the pool capacity arithmetic per configured database source', () => {
        // Arrange
        const config: ClusterBootRailsConfig = {
            ...baseConfig(),
            database: {
                sources: [
                    { key: 'main', poolMax: 10 },
                    { key: 'reports', poolMax: 5 },
                ],
            },
        };

        // Act
        runClusterBootRails(config, 3, logger);

        // Assert
        expect(info).toHaveBeenCalledWith('cluster.pool.capacity', {
            source: 'main',
            poolMax: 10,
            workers: 3,
            totalSessions: 30,
        });
        expect(info).toHaveBeenCalledWith('cluster.pool.capacity', {
            source: 'reports',
            poolMax: 5,
            workers: 3,
            totalSessions: 15,
        });
    });

    it('logs nothing about pools when no database is configured', () => {
        // Arrange
        const config = baseConfig();

        // Act
        runClusterBootRails(config, 3, logger);

        // Assert
        expect(info).not.toHaveBeenCalled();
    });
});
