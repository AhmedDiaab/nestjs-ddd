import { VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import request from 'supertest';
import type { App } from 'supertest/types';

const bootstrap = async (metricsEnabled: boolean) => {
    Object.assign(process.env, {
        NODE_ENV: 'test',
        JWT_SECRET: 'e2e-secret-that-is-at-least-32-chars',
        LOGGING_TO_FILE: 'false',
        LOG_LEVEL: 'error',
        METRICS_ENABLED: String(metricsEnabled),
        METRICS_DEFAULT_METRICS: 'false',
    });
    delete process.env.DATABASE_CONFIG_JSON;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<INestApplication<App>>();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    return app;
};

describe('Metrics (e2e)', () => {
    describe('enabled', () => {
        let app: INestApplication<App>;

        beforeAll(async () => {
            app = await bootstrap(true);
        });

        afterAll(async () => {
            await app.close();
            delete process.env.METRICS_ENABLED;
        });

        it('serves the Prometheus exposition format', async () => {
            // Arrange: one request to have something to count
            await request(app.getHttpServer()).get('/health');

            // Act
            const res = await request(app.getHttpServer()).get('/metrics');

            // Assert
            expect(res.status).toBe(200);
            expect(res.text).toContain('# TYPE http_server_requests_total counter');
        });

        it('counts served requests by route template and status', async () => {
            // Arrange
            await request(app.getHttpServer()).get('/health');

            // Act
            const res = await request(app.getHttpServer()).get('/metrics');

            // Assert
            expect(res.text).toMatch(
                /http_server_requests_total\{method="GET",route="\/health",status="200"/,
            );
        });

        it('labels unknown paths with the fallback route, not the URL that was tried', async () => {
            // Arrange
            await request(app.getHttpServer()).get('/v1/definitely-not-here');

            // Act
            const res = await request(app.getHttpServer()).get('/metrics');

            // Assert: one series for every unknown path, not one per probe
            expect(res.text).not.toContain('definitely-not-here');
            expect(res.text).toMatch(/route="\/v1\/\*all",status="404"/);
        });

        it('is served as the Prometheus text format, not wrapped in the envelope', async () => {
            // Arrange: a scraper parses the body directly

            // Act
            const res = await request(app.getHttpServer()).get('/metrics');

            // Assert
            expect(res.headers['content-type']).toContain('text/plain');
            expect(res.text.startsWith('# HELP')).toBe(true);
        });

        it('needs no token, like the health endpoints', async () => {
            // Arrange: no Authorization header

            // Act
            const res = await request(app.getHttpServer()).get('/metrics');

            // Assert
            expect(res.status).toBe(200);
        });
    });

    describe('disabled', () => {
        let app: INestApplication<App>;

        beforeAll(async () => {
            app = await bootstrap(false);
        });

        afterAll(async () => {
            await app.close();
            delete process.env.METRICS_ENABLED;
        });

        it('answers 404, so "off" looks different from "no data"', async () => {
            // Arrange: METRICS_ENABLED=false

            // Act
            const res = await request(app.getHttpServer()).get('/metrics');

            // Assert
            expect(res.status).toBe(404);
        });
    });
});
