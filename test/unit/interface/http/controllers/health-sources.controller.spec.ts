import type { ConfigPort, DatabaseHealthPort, SourceHealthView } from '@application/ports';
import { HealthSourcesController } from '@interface/http/controllers';

const source = (overrides: Partial<SourceHealthView> = {}): SourceHealthView => ({
    key: 'main',
    dialect: 'oracle',
    implemented: true,
    ok: true,
    latencyMs: 3,
    ...overrides,
});

describe('HealthSourcesController', () => {
    it('returns every source, including the error text a down source carries', async () => {
        // Arrange
        const down = source({ key: 'reports', ok: false, error: 'NJS-503: connection refused' });
        const databaseHealth = { check: jest.fn(() => Promise.resolve([source(), down])) };
        const config = { get: () => 1000 } as unknown as ConfigPort;
        const sut = new HealthSourcesController(
            databaseHealth as unknown as DatabaseHealthPort,
            config,
        );

        // Act
        const result = await sut.list();

        // Assert
        expect(result).toEqual({ sources: [source(), down] });
        expect(databaseHealth.check).toHaveBeenCalledWith(1000);
    });
});
