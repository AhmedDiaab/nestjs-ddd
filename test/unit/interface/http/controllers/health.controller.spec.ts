import type { ConfigPort } from '@application/ports';
import type { ConnectionProvider, SourceHealth } from '@infrastructure/database/contracts';
import { HealthController } from '@interface/http/controllers';
import { ServiceUnavailableException } from '@nestjs/common';

const source = (overrides: Partial<SourceHealth>): SourceHealth => ({
    sourceKey: 'main',
    dialect: 'oracle',
    implemented: true,
    ok: true,
    latencyMs: 3,
    ...overrides,
});

describe('HealthController', () => {
    const createController = (sources: SourceHealth[], production = false) => {
        const db = { health: jest.fn(() => Promise.resolve(sources)) };
        const config = {
            get: () => 1000,
            isProduction: () => production,
        } as unknown as ConfigPort;
        return {
            controller: new HealthController(db as unknown as ConnectionProvider, config),
            db,
        };
    };

    const readyError = async (controller: HealthController) => {
        try {
            await controller.ready();
        } catch (e) {
            return e as ServiceUnavailableException;
        }
        throw new Error('expected ready() to throw');
    };

    it('reports liveness without checking dependencies', () => {
        // Arrange
        const { controller, db } = createController([]);

        // Act
        const result = controller.live();

        // Assert
        expect(result).toEqual({ status: 'ok' });
        expect(db.health).not.toHaveBeenCalled();
    });

    it('is ready when every implemented source answers, ignoring placeholders', async () => {
        // Arrange
        const placeholder = source({ sourceKey: 'reports', implemented: false, ok: false });
        const { controller, db } = createController([source({}), placeholder]);

        // Act
        const result = await controller.ready();

        // Assert
        expect(result.status).toBe('ok');
        expect(db.health).toHaveBeenCalledWith(1000);
    });

    it('throws 503 NOT_READY with per-source details when a source is down', async () => {
        // Arrange
        const down = source({ ok: false, error: 'NJS-503: connection refused' });
        const { controller } = createController([down]);

        // Act
        const error = await readyError(controller);

        // Assert
        expect(error).toBeInstanceOf(ServiceUnavailableException);
        expect(error.getStatus()).toBe(503);
        expect(error.getResponse()).toMatchObject({
            code: 'NOT_READY',
            details: [expect.objectContaining({ sourceKey: 'main', ok: false })],
        });
    });

    it('hides source error text in production', async () => {
        // Arrange
        const down = source({ ok: false, error: 'NJS-503: connection refused' });
        const { controller } = createController([down], true);

        // Act
        const error = await readyError(controller);

        // Assert
        const { details } = error.getResponse() as { details: SourceHealth[] };
        expect(details[0].error).toBeUndefined();
    });
});
