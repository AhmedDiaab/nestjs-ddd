import { ConnectionProviderToken } from '@infrastructure/database/connection';
import type { SourceHealth } from '@infrastructure/database/contracts';
import { Public, UseZodHttp, Validated } from '@interface/http/decorators';
import { Controller, Get, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import request from 'supertest';
import type { App } from 'supertest/types';
import { z } from 'zod';
import { signJwt } from '../fakes/sign-jwt';

const SECRET = 'e2e-secret-that-is-at-least-32-chars';

const adminToken = () =>
    signJwt(
        {
            id: 'u-1',
            username: 'alice',
            admin: false,
            email: 'alice@example.com',
            name: 'Alice',
            roles: ['admin'],
        },
        SECRET,
    );

type ErrorEnvelope = {
    success: false;
    error: { message: string; code?: string; details?: unknown };
};

type SuccessEnvelope = { success: true; data: unknown };

/** Test-only route: the template ships no validated endpoint of its own. */
@Public() // authentication is global; this probe is about validation, not auth
@Controller('e2e-validation')
class ValidationProbeController {
    @Get()
    @UseZodHttp({ query: z.object({ page: z.coerce.number().int().min(1) }) })
    list(@Validated('query') query: { page: number }) {
        return query;
    }
}

describe('HTTP error responses (e2e)', () => {
    let app: INestApplication<App>;
    const health: SourceHealth[] = [];
    const connectionProvider = { health: () => Promise.resolve(health) };

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: SECRET,
            LOGGING_TO_FILE: 'false',
            LOG_LEVEL: 'error',
        });
        delete process.env.DATABASE_CONFIG_JSON;

        const moduleRef = await Test.createTestingModule({
            controllers: [ValidationProbeController],
            imports: [AppModule],
        })
            .overrideProvider(ConnectionProviderToken)
            .useValue(connectionProvider)
            .compile();

        app = moduleRef.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();
    });

    afterAll(() => app.close());

    beforeEach(() => {
        health.length = 0;
    });

    it('GET /health/ready returns 503 with no source detail when a database source is down', async () => {
        // Arrange
        health.push({
            sourceKey: 'main',
            dialect: 'oracle',
            implemented: true,
            ok: false,
            latencyMs: 3000,
            error: 'NJS-503: connection refused',
        });

        // Act
        const res = await request(app.getHttpServer()).get('/health/ready');

        // Assert
        expect(res.status).toBe(503);
        expect(res.body as ErrorEnvelope).toMatchObject({
            success: false,
            error: { message: 'Not ready', code: 'NOT_READY' },
        });
        expect((res.body as ErrorEnvelope).error.details).toBeUndefined();
    });

    it('GET /v1/health/sources still shows the failing source, for an admin token', async () => {
        // Arrange
        health.push({
            sourceKey: 'main',
            dialect: 'oracle',
            implemented: true,
            ok: false,
            latencyMs: 3000,
            error: 'NJS-503: connection refused',
        });
        const call = request(app.getHttpServer())
            .get('/v1/health/sources')
            .set('Authorization', `Bearer ${adminToken()}`);

        // Act
        const res = await call;

        // Assert
        expect(res.status).toBe(200);
        expect((res.body as SuccessEnvelope).data).toEqual({
            sources: [
                expect.objectContaining({
                    key: 'main',
                    ok: false,
                    error: 'NJS-503: connection refused',
                }),
            ],
        });
    });

    it('returns 400 with the envelope when query validation fails', async () => {
        // Arrange
        const path = '/v1/e2e-validation?page=0';

        // Act
        const res = await request(app.getHttpServer()).get(path);

        // Assert
        expect(res.status).toBe(400);
        expect(res.body as ErrorEnvelope).toMatchObject({
            success: false,
            error: { message: 'Validation failed' },
        });
    });

    it('passes validated and coerced query values to the handler', async () => {
        // Arrange
        const path = '/v1/e2e-validation?page=2';

        // Act
        const res = await request(app.getHttpServer()).get(path);

        // Assert
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, data: { page: 2 } });
    });
});
