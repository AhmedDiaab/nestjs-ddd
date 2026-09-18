import { Public } from '@interface/http/decorators';
import { Controller, Get, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import request, { type Response } from 'supertest';
import type { App } from 'supertest/types';

/** Test-only read route; the throttler guard runs ahead of authentication, so `@Public()`
 * keeps the global JWT guard out of the way and only the rate limiter is under test. */
@Public()
@Controller('e2e-throttle')
class ThrottleProbeController {
    @Get()
    ping() {
        return { pong: true };
    }
}

type Envelope = { success: boolean; error?: { message?: string; code?: string } };

async function bootApp(env: Record<string, string>): Promise<INestApplication<App>> {
    Object.assign(process.env, {
        NODE_ENV: 'test',
        JWT_SECRET: 'e2e-secret-that-is-at-least-32-chars',
        LOGGING_TO_FILE: 'false',
        LOG_LEVEL: 'error',
        ...env,
    });
    delete process.env.DATABASE_CONFIG_JSON;

    const moduleRef = await Test.createTestingModule({
        controllers: [ThrottleProbeController],
        imports: [AppModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    return app;
}

/** Sends the requests one at a time so the throttler's per-key counter advances deterministically. */
async function sendSequentially(server: App, times: number): Promise<Response[]> {
    const responses: Response[] = [];
    for (let i = 0; i < times; i += 1) {
        responses.push(await request(server).get('/v1/e2e-throttle'));
    }
    return responses;
}

describe('Throttling (e2e)', () => {
    describe('when a burst exceeds the configured limit', () => {
        let app: INestApplication<App>;

        beforeAll(async () => {
            app = await bootApp({ THROTTLE_LIMIT: '2', THROTTLE_TTL_MS: '60000' });
        });

        afterAll(async () => {
            await app.close();
            delete process.env.THROTTLE_LIMIT;
            delete process.env.THROTTLE_TTL_MS;
        });

        it('lets requests through up to the limit, then rejects the rest with 429', async () => {
            // Arrange
            const server = app.getHttpServer();

            // Act
            const [first, second, third] = await sendSequentially(server, 3);

            // Assert
            expect(first.status).toBe(200);
            expect(second.status).toBe(200);
            expect(third.status).toBe(429);
            expect(third.body as Envelope).toMatchObject({
                success: false,
                error: { message: 'ThrottlerException: Too Many Requests' },
            });
        });
    });

    describe('when the limit is 0', () => {
        let app: INestApplication<App>;

        beforeAll(async () => {
            app = await bootApp({ THROTTLE_LIMIT: '0', THROTTLE_TTL_MS: '60000' });
        });

        afterAll(async () => {
            await app.close();
            delete process.env.THROTTLE_LIMIT;
            delete process.env.THROTTLE_TTL_MS;
        });

        it('skips throttling entirely, so a burst past any real limit still succeeds', async () => {
            // Arrange
            const server = app.getHttpServer();

            // Act
            const responses = await sendSequentially(server, 5);

            // Assert
            expect(responses.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
        });
    });
});
