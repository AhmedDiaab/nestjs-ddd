import { Deprecated, Public } from '@interface/http/decorators';
import { Controller, Get, VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import request from 'supertest';
import type { App } from 'supertest/types';

/** Test-only probe: `@Public()` keeps the global JWT guard out of the way, so the response
 * headers under test aren't entangled with authentication. */
@Public()
@Controller('e2e-deprecation')
class DeprecationProbeController {
    @Get('full')
    @Deprecated({
        since: '2026-01-01',
        sunset: '2026-12-31',
        successor: 'https://api.example.com/v2/orders',
        link: 'https://docs.example.com/deprecations/orders-v1',
        note: 'Use v2 instead.',
    })
    full() {
        return { ok: true };
    }

    @Get('dates-only')
    @Deprecated({ since: '2026-01-01', sunset: '2026-12-31' })
    datesOnly() {
        return { ok: true };
    }

    @Get('already-sunset')
    @Deprecated({ since: '2020-01-01', sunset: '2020-06-30' })
    alreadySunset() {
        return { ok: true };
    }

    @Get('undecorated')
    undecorated() {
        return { ok: true };
    }
}

describe('Deprecation headers (e2e)', () => {
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
            controllers: [DeprecationProbeController],
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();
    });

    afterAll(async () => {
        await app.close();
    });

    it('sets Deprecation, Sunset and both Link relations for a fully specified route', async () => {
        // Arrange
        const req = request(app.getHttpServer()).get('/v1/e2e-deprecation/full');

        // Act
        const res = await req;

        // Assert
        expect(res.status).toBe(200);
        expect(res.headers['deprecation']).toBe(
            `@${Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000)}`,
        );
        expect(res.headers['sunset']).toBe(new Date('2026-12-31T00:00:00Z').toUTCString());
        expect(res.headers['link']).toContain('rel="successor-version"');
        expect(res.headers['link']).toContain('rel="deprecation"');
    });

    it('sets Deprecation and Sunset with no Link header when only the dates are given', async () => {
        // Arrange
        const req = request(app.getHttpServer()).get('/v1/e2e-deprecation/dates-only');

        // Act
        const res = await req;

        // Assert
        expect(res.status).toBe(200);
        expect(res.headers['deprecation']).toBe(
            `@${Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000)}`,
        );
        expect(res.headers['sunset']).toBe(new Date('2026-12-31T00:00:00Z').toUTCString());
        expect(res.headers['link']).toBeUndefined();
    });

    it('still returns 200 with the headers when the sunset date is already past', async () => {
        // Arrange
        const req = request(app.getHttpServer()).get('/v1/e2e-deprecation/already-sunset');

        // Act
        const res = await req;

        // Assert: the headers are advisory and do not block the request
        expect(res.status).toBe(200);
        expect(res.headers['deprecation']).toBe(
            `@${Math.floor(Date.parse('2020-01-01T00:00:00Z') / 1000)}`,
        );
        expect(res.headers['sunset']).toBe(new Date('2020-06-30T00:00:00Z').toUTCString());
    });

    it('carries none of the three headers on an undecorated route', async () => {
        // Arrange
        const req = request(app.getHttpServer()).get('/v1/e2e-deprecation/undecorated');

        // Act
        const res = await req;

        // Assert
        expect(res.status).toBe(200);
        expect(res.headers['deprecation']).toBeUndefined();
        expect(res.headers['sunset']).toBeUndefined();
        expect(res.headers['link']).toBeUndefined();
    });
});
