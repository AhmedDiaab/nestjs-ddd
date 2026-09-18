import type { ConnectionProvider, SourceHealth } from '@infrastructure/database/contracts';
import { PoolHealthAdapter } from '@infrastructure/database/health';

const source = (overrides: Partial<SourceHealth> = {}): SourceHealth => ({
    sourceKey: 'main',
    dialect: 'oracle',
    implemented: true,
    ok: true,
    latencyMs: 4,
    ...overrides,
});

describe('PoolHealthAdapter', () => {
    it('maps the driver-facing source health to the application view', async () => {
        // Arrange
        const health = jest.fn(() => Promise.resolve([source()]));
        const db = { health } as unknown as ConnectionProvider;
        const sut = new PoolHealthAdapter(db);

        // Act
        const result = await sut.check(1000);

        // Assert
        expect(result).toEqual([
            { key: 'main', dialect: 'oracle', implemented: true, ok: true, latencyMs: 4 },
        ]);
        expect(health).toHaveBeenCalledWith(1000);
    });

    it('carries the error text through for a failing source', async () => {
        // Arrange
        const down = source({ ok: false, error: 'NJS-503: connection refused' });
        const db = {
            health: jest.fn(() => Promise.resolve([down])),
        } as unknown as ConnectionProvider;
        const sut = new PoolHealthAdapter(db);

        // Act
        const [result] = await sut.check();

        // Assert
        expect(result.ok).toBe(false);
        expect(result.error).toBe('NJS-503: connection refused');
    });

    it('drops the pool counters, which are for metrics, not the health view', async () => {
        // Arrange
        const withPool = source({ pool: { connectionsOpen: 2, connectionsInUse: 1 } });
        const db = {
            health: jest.fn(() => Promise.resolve([withPool])),
        } as unknown as ConnectionProvider;
        const sut = new PoolHealthAdapter(db);

        // Act
        const [result] = await sut.check();

        // Assert
        expect(result).not.toHaveProperty('pool');
    });
});
