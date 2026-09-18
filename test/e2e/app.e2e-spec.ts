import { VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import request from 'supertest';
import type { App } from 'supertest/types';
import { signJwt } from '../fakes/sign-jwt';

type Envelope = {
    success: boolean;
    data?: unknown;
    error?: { message: string };
    meta: { path: string; requestId: string | null };
};

const SECRET = 'e2e-secret-that-is-at-least-32-chars';

const tokenFor = (roles?: string[]) =>
    signJwt(
        {
            id: 'u-1',
            username: 'alice',
            admin: false,
            email: 'alice@example.com',
            name: 'Alice',
            ...(roles ? { roles } : {}),
        },
        SECRET,
    );

describe('App (e2e, no database configured)', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: SECRET,
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

    it('GET /health/ready carries no source detail in the body', async () => {
        // Arrange: app started without a database

        // Act
        const res = await request(app.getHttpServer()).get('/health/ready');

        // Assert
        expect(res.status).toBe(200);
        expect((res.body as Envelope).data).toEqual({ status: 'ok' });
    });

    it('GET /v1/health/sources needs a token', async () => {
        // Arrange: no Authorization header

        // Act
        const res = await request(app.getHttpServer()).get('/v1/health/sources');

        // Assert
        expect(res.status).toBe(401);
    });

    it('GET /v1/health/sources refuses a token without the admin role', async () => {
        // Arrange
        const call = request(app.getHttpServer())
            .get('/v1/health/sources')
            .set('Authorization', `Bearer ${tokenFor(['viewer'])}`);

        // Act
        const res = await call;

        // Assert
        expect(res.status).toBe(403);
    });

    it('GET /v1/health/sources lists the sources for an admin token, with no database configured', async () => {
        // Arrange
        const call = request(app.getHttpServer())
            .get('/v1/health/sources')
            .set('Authorization', `Bearer ${tokenFor(['admin'])}`);

        // Act
        const res = await call;

        // Assert
        expect(res.status).toBe(200);
        expect((res.body as Envelope).data).toEqual({ sources: [] });
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
