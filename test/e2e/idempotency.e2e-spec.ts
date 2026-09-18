import { setTimeout as delay } from 'node:timers/promises';
import { VersioningType, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import request from 'supertest';
import type { App } from 'supertest/types';
import { IdempotencyProbeController } from '../fixtures/http/idempotency-probe.controller';

type Envelope = {
    success: boolean;
    data?: unknown;
    error?: { code?: string };
    meta: { requestId: string };
};

describe('Idempotent POSTs (e2e)', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: 'e2e-secret-that-is-at-least-32-chars',
            LOGGING_TO_FILE: 'false',
            LOG_LEVEL: 'error',
        });
        delete process.env.DATABASE_CONFIG_JSON; // IDEMPOTENCY_STORE defaults to memory

        const moduleRef = await Test.createTestingModule({
            controllers: [IdempotencyProbeController],
            imports: [AppModule],
        }).compile();

        app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();
    });

    afterEach(() => IdempotencyProbeController.reset());

    afterAll(async () => {
        await app.close();
    });

    it('runs the handler once and replays the first response for a retried key with the same body', async () => {
        // Arrange
        const body = { total: 10 };

        // Act
        const first = await request(app.getHttpServer())
            .post('/v1/e2e-idempotency')
            .set('Idempotency-Key', 'order-1')
            .set('x-request-id', 'req-1')
            .send(body);
        const second = await request(app.getHttpServer())
            .post('/v1/e2e-idempotency')
            .set('Idempotency-Key', 'order-1')
            .set('x-request-id', 'req-2')
            .send(body);

        // Assert
        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect((second.body as Envelope).data).toEqual((first.body as Envelope).data);
        expect(IdempotencyProbeController.executions).toBe(1);
        // the replay is re-wrapped with the replaying request's own meta, not the original's
        expect((second.body as Envelope).meta.requestId).toBe('req-2');
        expect((second.body as Envelope).meta.requestId).not.toBe(
            (first.body as Envelope).meta.requestId,
        );
    });

    it('rejects a reused key sent with a different body with 422', async () => {
        // Arrange
        await request(app.getHttpServer())
            .post('/v1/e2e-idempotency')
            .set('Idempotency-Key', 'order-2')
            .send({ total: 10 });

        // Act
        const res = await request(app.getHttpServer())
            .post('/v1/e2e-idempotency')
            .set('Idempotency-Key', 'order-2')
            .send({ total: 999 });

        // Assert
        expect(res.status).toBe(422);
        expect((res.body as Envelope).error?.code).toBe('IDEMPOTENCY_KEY_REUSED');
        expect(IdempotencyProbeController.executions).toBe(1);
    });

    it('rejects a decorated route called without the key header with 400', async () => {
        // Act
        const res = await request(app.getHttpServer())
            .post('/v1/e2e-idempotency')
            .send({ total: 10 });

        // Assert
        expect(res.status).toBe(400);
        expect((res.body as Envelope).error?.code).toBe('MISSING_IDEMPOTENCY_KEY');
        expect(IdempotencyProbeController.executions).toBe(0);
    });

    it('rejects a concurrent retry with 409 while the first call is still running', async () => {
        // Arrange
        IdempotencyProbeController.delayMs = 300;
        const first = request(app.getHttpServer())
            .post('/v1/e2e-idempotency')
            .set('Idempotency-Key', 'order-3')
            .send({ total: 10 })
            .then((res) => res); // .then() dispatches now; a bare Test object waits for the last await
        await delay(50); // let the first request claim the key before the second arrives

        // Act
        const second = await request(app.getHttpServer())
            .post('/v1/e2e-idempotency')
            .set('Idempotency-Key', 'order-3')
            .send({ total: 10 });

        // Assert
        expect(second.status).toBe(409);
        expect((second.body as Envelope).error?.code).toBe('IDEMPOTENCY_IN_PROGRESS');
        await first;
        expect(IdempotencyProbeController.executions).toBe(1);
    });

    it('releases the key when the handler fails, so the retry executes again', async () => {
        // Arrange
        const body = { total: 10, fail: true };
        const first = await request(app.getHttpServer())
            .post('/v1/e2e-idempotency')
            .set('Idempotency-Key', 'order-4')
            .send(body);

        // Act
        const second = await request(app.getHttpServer())
            .post('/v1/e2e-idempotency')
            .set('Idempotency-Key', 'order-4')
            .send(body);

        // Assert
        expect(first.status).toBe(500);
        expect(second.status).toBe(500);
        expect(IdempotencyProbeController.executions).toBe(2);
    });

    it('does not touch an undecorated route', async () => {
        // Act
        const res = await request(app.getHttpServer()).get('/health');

        // Assert
        expect(res.status).toBe(200);
    });
});
