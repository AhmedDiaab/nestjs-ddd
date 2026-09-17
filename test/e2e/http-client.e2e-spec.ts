import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_NAME } from '@shared';
import { AppModule } from '@src/app.module';
import request from 'supertest';
import type { App } from 'supertest/types';
import { UpstreamProbeController } from '../fixtures/http/upstream-probe.controller';

type Envelope = { success: boolean; data: { seenHeaders: Record<string, string> } };

describe('Outbound HTTP (e2e)', () => {
    let app: INestApplication<App>;
    let upstream: Server;
    const received: IncomingMessage['headers'][] = [];

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: 'e2e-secret-that-is-at-least-32-chars',
            LOGGING_TO_FILE: 'false',
            LOG_LEVEL: 'error',
        });
        delete process.env.DATABASE_CONFIG_JSON;

        upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
            received.push(req.headers);
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ seenHeaders: req.headers }));
        });
        await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
        const address = upstream.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        UpstreamProbeController.upstreamUrl = `http://127.0.0.1:${port}/downstream`;

        const moduleRef = await Test.createTestingModule({
            controllers: [UpstreamProbeController],
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();
    });

    afterAll(async () => {
        await app.close();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
    });

    it('passes the incoming request id on to the service it calls', async () => {
        // Arrange
        const requestId = 'e2e-correlation-1';

        // Act
        const res = await request(app.getHttpServer())
            .get('/v1/e2e-upstream')
            .set('x-request-id', requestId);

        // Assert
        expect(res.status).toBe(200);
        expect((res.body as Envelope).data.seenHeaders['x-request-id']).toBe(requestId);
    });

    it('generates a correlation id when the caller did not send one', async () => {
        // Arrange
        received.length = 0;

        // Act
        const res = await request(app.getHttpServer()).get('/v1/e2e-upstream');

        // Assert: the upstream saw the same id this service reports in meta
        const seen = (res.body as Envelope).data.seenHeaders['x-request-id'];
        expect(seen).toBeDefined();
        expect(seen).toBe((res.body as { meta: { requestId: string } }).meta.requestId);
    });

    it('identifies itself with the project name as its user agent', async () => {
        // Arrange
        received.length = 0;

        // Act
        await request(app.getHttpServer()).get('/v1/e2e-upstream');

        // Assert
        expect(received[0]?.['user-agent']).toBe(APP_NAME);
    });

    it('continues the caller\u2019s W3C trace when calling the next service', async () => {
        // Arrange
        received.length = 0;
        const traceId = 'a'.repeat(32);
        const traceparent = `00-${traceId}-${'b'.repeat(16)}-01`;

        // Act
        const res = await request(app.getHttpServer())
            .get('/v1/e2e-upstream')
            .set('traceparent', traceparent);

        // Assert: same trace, this service's own span
        const sent = (res.body as Envelope).data.seenHeaders.traceparent;
        expect(sent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
        expect(sent).not.toBe(traceparent);
    });

    it('starts a trace of its own when the caller sent none', async () => {
        // Arrange
        received.length = 0;

        // Act
        const res = await request(app.getHttpServer()).get('/v1/e2e-upstream');

        // Assert
        expect((res.body as Envelope).data.seenHeaders.traceparent).toMatch(
            /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/,
        );
    });

    it('returns the correlation and trace headers to its own caller', async () => {
        // Arrange
        const requestId = 'e2e-echo-1';

        // Act
        const res = await request(app.getHttpServer())
            .get('/v1/e2e-upstream')
            .set('x-request-id', requestId);

        // Assert: a caller that never parses the envelope can still correlate a failure
        expect(res.headers['x-request-id']).toBe(requestId);
        expect(res.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);
    });

    it('replaces a correlation id that is not safe to print', async () => {
        // Arrange
        // no newline: Node's own client rejects those. Still hostile: 500 chars of quoted JSON
        const hostile = `"level":30,"msg":"fake log line" ${'x'.repeat(500)}`;

        // Act
        const res = await request(app.getHttpServer())
            .get('/v1/e2e-upstream')
            .set('x-request-id', hostile);

        // Assert
        expect(res.headers['x-request-id']).not.toBe(hostile);
        expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
    });
});
