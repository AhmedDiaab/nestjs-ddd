/**
 * Live Oracle checks for OracleIdempotencyStore. Skipped unless ORACLE_IT_PASSWORD is set.
 * Same env as oracle.client.int-spec.ts.
 *
 *   ORACLE_IT_PASSWORD=... pnpm test:oracle
 */
import type { ConfigPort } from '@application/ports';
import { databaseConfigSchema } from '@infrastructure/config/schemas';
import { PoolManager } from '@infrastructure/database/connection';
import { OracleIdempotencyStore } from '@infrastructure/database/idempotency';
import type { Connection } from 'oracledb';

const password = process.env.ORACLE_IT_PASSWORD;
const describeLive = password ? describe : describe.skip;

const configWith = (values: Record<string, unknown>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigPort;

describeLive('OracleIdempotencyStore (live Oracle)', () => {
    const table = `IT_IDEMPOTENCY_${Date.now()}`;
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const db = new PoolManager(logger);
    const config = configWith({
        'idempotency.table': table,
        'idempotency.ttlMs': 86_400_000,
        'idempotency.inProgressTtlMs': 60_000,
    });
    const sut = new OracleIdempotencyStore(db, config);

    beforeAll(async () => {
        await db.init(
            databaseConfigSchema.parse({
                sources: [
                    {
                        key: 'main',
                        dialect: 'oracle',
                        connectString:
                            process.env.ORACLE_IT_CONNECT_STRING ?? 'localhost:1521/FREEPDB1',
                        user: process.env.ORACLE_IT_USER ?? 'app',
                        password,
                        // >1 so two concurrent claims exercise two connections, not one queued
                        poolMin: 2,
                        poolMax: 5,
                    },
                ],
                health: {},
            }),
        );
        await db.withConnection('main', (conn: Connection) =>
            conn.execute(`CREATE TABLE ${table} (
                key VARCHAR2(128) PRIMARY KEY,
                fingerprint VARCHAR2(64),
                state VARCHAR2(16),
                status NUMBER,
                response_body CLOB,
                created_at TIMESTAMP,
                expires_at TIMESTAMP
            )`),
        );
    });

    afterAll(async () => {
        await db
            .withConnection('main', (conn: Connection) => conn.execute(`DROP TABLE ${table} PURGE`))
            .catch(() => undefined);
        await db.onModuleDestroy();
    });

    it('claims a key that has never been seen', async () => {
        // Arrange
        const key = `it-key-${Date.now()}-1`;

        // Act
        const outcome = await sut.claim(key, 'fp-1');

        // Assert
        expect(outcome).toEqual({ outcome: 'claimed' });
    });

    it('replays the stored status and body once completed with the same fingerprint', async () => {
        // Arrange
        const key = `it-key-${Date.now()}-2`;
        await sut.claim(key, 'fp-1');
        await sut.complete(key, 201, { id: 'abc' });

        // Act
        const outcome = await sut.claim(key, 'fp-1');

        // Assert
        expect(outcome).toEqual({ outcome: 'replay', status: 201, body: { id: 'abc' } });
    });

    it('reports a mismatch when the same key is reused with a different body', async () => {
        // Arrange
        const key = `it-key-${Date.now()}-3`;
        await sut.claim(key, 'fp-1');
        await sut.complete(key, 200, { id: 'abc' });

        // Act
        const outcome = await sut.claim(key, 'fp-different');

        // Assert
        expect(outcome).toEqual({ outcome: 'mismatch' });
    });

    it('reports in-progress while the first claim has not completed yet', async () => {
        // Arrange
        const key = `it-key-${Date.now()}-4`;
        await sut.claim(key, 'fp-1');

        // Act
        const outcome = await sut.claim(key, 'fp-1');

        // Assert
        expect(outcome).toEqual({ outcome: 'in_progress' });
    });

    it('lets a released key be re-claimed immediately', async () => {
        // Arrange
        const key = `it-key-${Date.now()}-5`;
        await sut.claim(key, 'fp-1');
        await sut.release(key);

        // Act
        const outcome = await sut.claim(key, 'fp-anything');

        // Assert
        expect(outcome).toEqual({ outcome: 'claimed' });
    });

    it('lets exactly one of two concurrent claims on the same key win', async () => {
        // Arrange
        const key = `it-key-${Date.now()}-6`;

        // Act
        const [a, b] = await Promise.all([sut.claim(key, 'fp-1'), sut.claim(key, 'fp-1')]);

        // Assert: the unique index is the lock, so exactly one connection sees "claimed"
        expect([a.outcome, b.outcome].sort()).toEqual(['claimed', 'in_progress']);
    });
});
