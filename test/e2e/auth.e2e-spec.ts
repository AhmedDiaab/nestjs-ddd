import { VersioningType, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import request from 'supertest';
import type { App } from 'supertest/types';
import { MixedAuthController } from '../fixtures/http/mixed-auth.controller';
import { OpenAuthController } from '../fixtures/http/open-auth.controller';
import { RolesAuthController } from '../fixtures/http/roles-auth.controller';
import { SilentAuthController } from '../fixtures/http/silent-auth.controller';

const SECRET = 'e2e-secret-that-is-at-least-32-chars';

const tokenFor = (roles?: string[]) =>
    new JwtService({ secret: SECRET }).sign({
        id: 'u-1',
        username: 'alice',
        admin: false,
        email: 'alice@example.com',
        name: 'Alice',
        ...(roles ? { roles } : {}),
    });

describe('Authentication (e2e)', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: SECRET,
            LOGGING_TO_FILE: 'false',
            LOG_LEVEL: 'error',
        });
        delete process.env.DATABASE_CONFIG_JSON;

        const moduleRef = await Test.createTestingModule({
            controllers: [
                SilentAuthController,
                OpenAuthController,
                MixedAuthController,
                RolesAuthController,
            ],
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

    it('refuses a token without the required role with 403', async () => {
        // Arrange
        const call = request(app.getHttpServer())
            .get('/v1/e2e-auth/roles/admin-only')
            .set('Authorization', `Bearer ${tokenFor(['viewer'])}`);

        // Act
        const res = await call;

        // Assert
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ success: false });
    });

    it('accepts a token carrying the required role', async () => {
        // Arrange
        const call = request(app.getHttpServer())
            .get('/v1/e2e-auth/roles/admin-only')
            .set('Authorization', `Bearer ${tokenFor(['admin'])}`);

        // Act
        const res = await call;

        // Assert
        expect(res.status).toBe(200);
    });

    it('leaves a route that names no role open to any authenticated caller', async () => {
        // Arrange
        const call = request(app.getHttpServer())
            .get('/v1/e2e-auth/roles/any-user')
            .set('Authorization', `Bearer ${tokenFor()}`);

        // Act
        const res = await call;

        // Assert
        expect(res.status).toBe(200);
    });
});
