import { Public } from '@interface/http/decorators';
import { Controller, HttpCode, Post, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types';

/** Test-only write route; the CSRF guard runs before authentication, so `@Public()` keeps
 * the global JWT guard out of the way and the cookie alone drives the check. */
@Public()
@Controller('e2e-csrf')
class WriteProbeController {
    @Post()
    @HttpCode(200)
    write() {
        return { written: true };
    }
}

describe('CSRF protection (e2e)', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: 'e2e-secret-that-is-at-least-32-chars',
            LOGGING_TO_FILE: 'false',
            LOG_LEVEL: 'error',
            CORS_ORIGINS: 'https://app.example.com',
        });
        delete process.env.DATABASE_CONFIG_JSON;

        const moduleRef = await Test.createTestingModule({
            controllers: [WriteProbeController],
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();
        app.use(cookieParser());
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();
    });

    afterAll(async () => {
        await app.close();
        delete process.env.CORS_ORIGINS;
    });

    it('rejects a cookie-authenticated write from an untrusted origin with 403', async () => {
        // Arrange
        const attack = request(app.getHttpServer())
            .post('/v1/e2e-csrf')
            .set('Cookie', 'jwt=stolen-by-browser')
            .set('Origin', 'https://evil.example');

        // Act
        const res = await attack;

        // Assert
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ success: false, error: { code: 'CSRF_REJECTED' } });
    });

    it('lets the same write through from a trusted origin', async () => {
        // Arrange
        const legit = request(app.getHttpServer())
            .post('/v1/e2e-csrf')
            .set('Cookie', 'jwt=token')
            .set('Origin', 'https://app.example.com');

        // Act
        const res = await legit;

        // Assert
        expect(res.status).toBe(200);
    });
});
