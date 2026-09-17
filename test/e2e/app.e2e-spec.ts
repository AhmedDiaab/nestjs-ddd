import { VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import request from 'supertest';
import type { App } from 'supertest/types';

type Envelope = {
    success: boolean;
    data?: unknown;
    error?: { message: string };
    meta: { path: string; requestId: string | null };
};

describe('App (e2e, no database configured)', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: 'e2e-secret-that-is-at-least-32-chars',
            LOGGING_TO_FILE: 'false',
            LOG_LEVEL: 'error',
        });
        delete process.env.DATABASE_CONFIG_JSON;

        const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleFixture.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    it('wraps a response in the envelope with the request id the caller sent', async () => {
        // Arrange
        const requestId = 'e2e-1';

        // Act
        const res = await request(app.getHttpServer())
            .get('/health')
            .set('x-request-id', requestId);

        // Assert
        expect(res.status).toBe(200);
        expect(res.body as Envelope).toMatchObject({
            success: true,
            data: { status: 'ok' },
            meta: { path: '/health', requestId },
        });
    });

    it('serves no sample endpoint at the API root', async () => {
        // Arrange: a template that ships a demo route ships it to production

        // Act
        const res = await request(app.getHttpServer()).get('/v1');

        // Assert
        expect(res.status).toBe(404);
    });

    it('GET /health is version neutral', async () => {
        // Arrange: app started without a database

        // Act
        const res = await request(app.getHttpServer()).get('/health');

        // Assert
        expect(res.status).toBe(200);
        expect((res.body as Envelope).data).toEqual({ status: 'ok' });
    });

    it('GET /health/ready is ready with no sources', async () => {
        // Arrange: app started without a database

        // Act
        const res = await request(app.getHttpServer()).get('/health/ready');

        // Assert
        expect(res.status).toBe(200);
        expect((res.body as Envelope).data).toEqual({ status: 'ok', sources: [] });
    });

    it('unknown routes return a 404 envelope', async () => {
        // Arrange
        const path = '/v1/nope';

        // Act
        const res = await request(app.getHttpServer()).get(path);

        // Assert
        expect(res.status).toBe(404);
        expect(res.body as Envelope).toMatchObject({ success: false, meta: { path } });
    });

    it('protected routes return 401 without a token', async () => {
        // Arrange: no Authorization header or cookie

        // Act
        const res = await request(app.getHttpServer()).get('/v1/database-info');

        // Assert
        expect(res.status).toBe(401);
        expect((res.body as Envelope).success).toBe(false);
    });
});
