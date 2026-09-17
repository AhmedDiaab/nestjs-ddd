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

    it('GET /v1 wraps the response in the envelope with the request id', async () => {
        const res = await request(app.getHttpServer())
            .get('/v1')
            .set('x-request-id', 'e2e-1')
            .expect(200);

        const body = res.body as Envelope;
        expect(body).toMatchObject({
            success: true,
            data: 'Hello World!',
            meta: { path: '/v1', requestId: 'e2e-1' },
        });
    });

    it('GET /health is version neutral', async () => {
        const res = await request(app.getHttpServer()).get('/health').expect(200);
        expect((res.body as Envelope).data).toEqual({ status: 'ok' });
    });

    it('GET /health/ready is ready with no sources', async () => {
        const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
        expect((res.body as Envelope).data).toEqual({ status: 'ok', sources: [] });
    });

    it('unknown routes return a 404 envelope', async () => {
        const res = await request(app.getHttpServer()).get('/v1/nope').expect(404);
        expect(res.body as Envelope).toMatchObject({ success: false, meta: { path: '/v1/nope' } });
    });

    it('protected routes return 401 without a token', async () => {
        const res = await request(app.getHttpServer()).get('/v1/database-info').expect(401);
        expect((res.body as Envelope).success).toBe(false);
    });
});
