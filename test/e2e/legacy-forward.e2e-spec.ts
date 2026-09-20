import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LoggerPort } from '@application/ports';
import { LegacyForwarder } from '@infrastructure/legacy';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

type Envelope = { success: boolean; meta?: { path?: string } };

describe('Legacy forwarding (e2e)', () => {
    let app: NestExpressApplication;
    let upstream: Server;
    let upstreamPort: number;
    let capturedHeaders: IncomingMessage['headers'] = {};
    const loggedErrors: Array<{ message: string; meta: unknown }> = [];
    const forwarderLogger: LoggerPort = {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: (message, meta) => loggedErrors.push({ message, meta }),
    };

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: 'e2e-secret-that-is-at-least-32-chars',
            LOGGING_TO_FILE: 'false',
            LOG_LEVEL: 'error',
        });
        delete process.env.DATABASE_CONFIG_JSON;

        // A real upstream: proves bytes stream through the forwarder rather than being parsed.
        upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
            const path = (req.url ?? '').split('?')[0];

            if (path === '/v1/legacy/echo') {
                capturedHeaders = req.headers;
                req.resume();
                res.writeHead(201, { 'x-upstream': 'legacy-value', 'content-type': 'text/plain' });
                res.end('hello from legacy');
                return;
            }

            if (path === '/v1/legacy/boom') {
                req.resume();
                res.writeHead(500, { 'content-type': 'text/plain' });
                res.end('legacy failure');
                return;
            }

            if (path === '/v1/legacy/stall') {
                req.resume();
                // Deliberately never responds, to exercise the forwarder's own timeout.
                return;
            }

            if (path === '/v1/legacy/big') {
                let receivedLength = 0;
                req.on('data', (chunk: Buffer) => (receivedLength += chunk.length));
                req.on('end', () => {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ receivedLength }));
                });
                return;
            }

            req.resume();
            res.writeHead(404);
            res.end();
        });
        await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
        upstreamPort = (upstream.address() as AddressInfo).port;

        // Same pipeline order as src/main.ts: helmet, then the legacy forwarder, then
        // cookieParser and the body parsers — the forwarder must see the raw, unparsed stream.
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleRef.createNestApplication<NestExpressApplication>({
            bodyParser: false,
            rawBody: true,
        });

        app.use(helmet());

        const forwarder = new LegacyForwarder({
            targetUrl: `http://127.0.0.1:${upstreamPort}`,
            forwardPrefixes: ['/v1/legacy'],
            timeoutMs: 1000,
            preserveHostHeader: false,
            requestIdHeader: 'x-request-id',
            logger: forwarderLogger,
        });
        app.use(forwarder.middleware());

        app.use(cookieParser());
        app.useBodyParser('json', { limit: '1mb' });
        app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });

        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();
    });

    afterAll(async () => {
        await app.close();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
    });

    it('reaches the upstream for a configured prefix, with status, headers and body intact', async () => {
        // Arrange: '/v1/legacy' is a configured forward prefix

        // Act
        const res = await request(app.getHttpServer()).get('/v1/legacy/echo');

        // Assert
        expect(res.status).toBe(201);
        expect(res.headers['x-upstream']).toBe('legacy-value');
        expect(res.text).toBe('hello from legacy');
    });

    it('lets the upstream see Authorization, cookies and the request-id header', async () => {
        // Arrange
        capturedHeaders = {};

        // Act
        await request(app.getHttpServer())
            .get('/v1/legacy/echo')
            .set('Authorization', 'Bearer legacy-token')
            .set('Cookie', 'session=abc123')
            .set('x-request-id', 'trace-legacy-1');

        // Assert
        expect(capturedHeaders.authorization).toBe('Bearer legacy-token');
        expect(capturedHeaders.cookie).toBe('session=abc123');
        expect(capturedHeaders['x-request-id']).toBe('trace-legacy-1');
    });

    it('still returns the 404 envelope from FallbackController for an unmatched path', async () => {
        // Arrange
        const path = '/v1/not-yet-migrated';

        // Act
        const res = await request(app.getHttpServer()).get(path);

        // Assert
        expect(res.status).toBe(404);
        expect(res.body as Envelope).toMatchObject({ success: false, meta: { path } });
    });

    it('passes an upstream 500 through as 500, not 503', async () => {
        // Arrange: '/v1/legacy/boom' always answers 500

        // Act
        const res = await request(app.getHttpServer()).get('/v1/legacy/boom');

        // Assert
        expect(res.status).toBe(500);
        expect(res.text).toBe('legacy failure');
    });

    it('returns 504 within the configured timeout when the upstream never responds', async () => {
        // Arrange
        loggedErrors.length = 0;
        const startedAt = Date.now();

        // Act
        const res = await request(app.getHttpServer()).get('/v1/legacy/stall');
        const elapsedMs = Date.now() - startedAt;

        // Assert: well within the suite's own timeout, and never full-hangs
        expect(res.status).toBe(504);
        expect(elapsedMs).toBeLessThan(3000);
        expect(loggedErrors).toHaveLength(1);
        expect(loggedErrors[0]?.message).toBe('legacy.forward.failed');
        expect(loggedErrors[0]?.meta).toMatchObject({ status: 504 });
    });

    it('round-trips a multi-megabyte body without buffering it', async () => {
        // Arrange: 5 MiB, big enough to prove nothing buffers, small enough to stay fast
        const payload = Buffer.alloc(5 * 1024 * 1024, 'x');

        // Act
        const res = await request(app.getHttpServer())
            .post('/v1/legacy/big')
            .set('content-type', 'application/octet-stream')
            .send(payload);

        // Assert
        expect(res.status).toBe(200);
        expect((res.body as { receivedLength: number }).receivedLength).toBe(payload.length);
    });
});
