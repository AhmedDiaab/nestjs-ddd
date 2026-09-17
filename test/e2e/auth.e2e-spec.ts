import { VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import request from 'supertest';
import type { App } from 'supertest/types';
import { MixedAuthController } from '../fixtures/http/mixed-auth.controller';
import { OpenAuthController } from '../fixtures/http/open-auth.controller';
import { SilentAuthController } from '../fixtures/http/silent-auth.controller';

describe('Authentication (e2e)', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: 'e2e-secret-that-is-at-least-32-chars',
            LOGGING_TO_FILE: 'false',
            LOG_LEVEL: 'error',
        });
        delete process.env.DATABASE_CONFIG_JSON;

        const moduleRef = await Test.createTestingModule({
            controllers: [SilentAuthController, OpenAuthController, MixedAuthController],
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();
    });

    afterAll(() => app.close());

    it('protects a route that declares nothing', async () => {
        // Arrange: no token, no decorator on the controller

        // Act
        const res = await request(app.getHttpServer()).get('/v1/e2e-auth/silent');

        // Assert
        expect(res.status).toBe(401);
    });

    it('opens a controller marked @Public()', async () => {
        // Arrange: no token

        // Act
        const res = await request(app.getHttpServer()).get('/v1/e2e-auth/open');

        // Assert
        expect(res.status).toBe(200);
    });

    it('opens a single handler without opening its neighbours', async () => {
        // Arrange
        const server = app.getHttpServer();

        // Act
        const [open, closed] = await Promise.all([
            request(server).get('/v1/e2e-auth/mixed/open'),
            request(server).get('/v1/e2e-auth/mixed/closed'),
        ]);

        // Assert
        expect(open.status).toBe(200);
        expect(closed.status).toBe(401);
    });

    it('rejects a malformed bearer token on a protected route', async () => {
        // Arrange
        const call = request(app.getHttpServer())
            .get('/v1/e2e-auth/silent')
            .set('Authorization', 'Bearer not-a-jwt');

        // Act
        const res = await call;

        // Assert
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ success: false });
    });
});
