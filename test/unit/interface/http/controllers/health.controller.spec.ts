import type { ConfigPort, ShutdownPort } from '@application/ports';
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
    const createController = (sources: SourceHealth[], production = false, draining = false) => {
        const db = { health: jest.fn(() => Promise.resolve(sources)) };
        const config = {
            get: () => 1000,
            isProduction: () => production,
        } as unknown as ConfigPort;
        const shutdown: ShutdownPort = { isShuttingDown: () => draining, begin: () => true };
        return {
            controller: new HealthController(db as unknown as ConnectionProvider, config, shutdown),
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

    it('fails readiness while the process is shutting down, before dependencies are touched', async () => {
        // Arrange: draining, database still perfectly healthy
        const { controller, db } = createController([source({ ok: true })], false, true);

        // Act
        const error = await readyError(controller);

        // Assert
        expect(error.getStatus()).toBe(503);
        expect(error.getResponse()).toMatchObject({ code: 'SHUTTING_DOWN' });
        expect(db.health).not.toHaveBeenCalled();
    });

    it('keeps liveness green while draining, so the process is not killed mid-request', () => {
        // Arrange
        const { controller } = createController([], false, true);

        // Act
        const body = controller.live();

        // Assert
        expect(body).toEqual({ status: 'ok' });
    });
});
