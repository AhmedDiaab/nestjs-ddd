import { ShutdownPortToken, type ShutdownPort } from '@application/ports';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import request from 'supertest';
import type { App } from 'supertest/types';

type Envelope = { success: boolean; data?: unknown; error?: { code?: string } };

describe('Shutdown (e2e)', () => {
    let app: INestApplication<App>;
    let draining = false;
    const shutdown: ShutdownPort = {
        isShuttingDown: () => draining,
        begin: () => true,
    };

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: 'e2e-secret-that-is-at-least-32-chars',
            LOGGING_TO_FILE: 'false',
            LOG_LEVEL: 'error',
        });
        delete process.env.DATABASE_CONFIG_JSON;

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(ShutdownPortToken)
            .useValue(shutdown)
            .compile();

        app = moduleRef.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();
    });

    afterAll(() => app.close());

    beforeEach(() => {
        draining = false;
    });

    it('is ready while it is running', async () => {
        // Arrange: not draining

        // Act
        const res = await request(app.getHttpServer()).get('/health/ready');

        // Assert
        expect(res.status).toBe(200);
    });

    it('fails readiness as soon as the shutdown starts', async () => {
        // Arrange
        draining = true;

        // Act
        const res = await request(app.getHttpServer()).get('/health/ready');

        // Assert
        expect(res.status).toBe(503);
        expect((res.body as Envelope).error?.code).toBe('SHUTTING_DOWN');
    });

    it('keeps serving requests while draining, so in-flight work finishes', async () => {
        // Arrange
        draining = true;

        // Act
        const [live, unknown] = await Promise.all([
            request(app.getHttpServer()).get('/health'),
            request(app.getHttpServer()).get('/v1/anything'),
        ]);

        // Assert: the load balancer is told to stop sending, the port stays open
        expect(live.status).toBe(200);
        expect(unknown.status).toBe(404); // answered, not refused: the port is still open
    });
});
