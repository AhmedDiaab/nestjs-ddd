import type { ConfigPort } from '@application/ports';
import { InvalidConfigError } from '@infrastructure/config';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { OracleIdempotencyStore } from '@infrastructure/database/idempotency';
import oracledb from 'oracledb';

const configWith = (values: Record<string, unknown>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigPort;

const baseConfig = (overrides: Record<string, unknown> = {}) =>
    configWith({
        'idempotency.table': 'IDEMPOTENCY_KEYS',
        'idempotency.ttlMs': 86_400_000,
        'idempotency.inProgressTtlMs': 60_000,
        ...overrides,
    });

describe('OracleIdempotencyStore', () => {
    const connection = { execute: jest.fn() };
    const db = {
        transaction: jest.fn((_key: string, fn: (c: unknown) => Promise<unknown>) =>
            fn(connection),
        ),
    };

    afterEach(() => jest.clearAllMocks());

    it('rejects a table name that is not a safe SQL identifier', () => {
        // Arrange
        const config = baseConfig({ 'idempotency.table': 'keys; DROP TABLE users' });

        // Act
        const build = () => new OracleIdempotencyStore(db as unknown as ConnectionProvider, config);

        // Assert
        expect(build).toThrow(InvalidConfigError);
    });

    it('claims a new key with a single INSERT after purging expired rows, tagged for observability', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({}); // purge
        connection.execute.mockResolvedValueOnce({}); // insert
        const sut = new OracleIdempotencyStore(db as unknown as ConnectionProvider, baseConfig());

        // Act
        const outcome = await sut.claim('key-1', 'fp-1');

        // Assert
        expect(outcome).toEqual({ outcome: 'claimed' });
        expect(db.transaction).toHaveBeenCalledWith('main', expect.any(Function), {
            tag: 'idempotency.claim',
        });
        expect(connection.execute).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining('DELETE FROM IDEMPOTENCY_KEYS'),
        );
        expect(connection.execute).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('INSERT INTO IDEMPOTENCY_KEYS'),
            {
                p_key: 'key-1',
                p_fingerprint: 'fp-1',
                p_created: expect.any(Date) as Date,
                p_expires: expect.any(Date) as Date,
            },
        );
    });

    it('interpolates the configured table name into the SQL', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({});
        connection.execute.mockResolvedValueOnce({});
        const sut = new OracleIdempotencyStore(
            db as unknown as ConnectionProvider,
            baseConfig({ 'idempotency.table': 'CUSTOM_TABLE' }),
        );

        // Act
        await sut.claim('key-1', 'fp-1');

        // Assert
        expect(connection.execute).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('INSERT INTO CUSTOM_TABLE'),
            expect.anything(),
        );
    });

    it('replays the stored response when ORA-00001 finds a completed row with the same fingerprint', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({}); // purge
        connection.execute.mockRejectedValueOnce({
            errorNum: 1,
            message: 'ORA-00001: unique constraint',
        });
        connection.execute.mockResolvedValueOnce({
            rows: [
                {
                    FINGERPRINT: 'fp-1',
                    STATE: 'completed',
                    STATUS: 201,
                    RESPONSE_BODY: JSON.stringify({ id: 'abc' }),
                    CREATED_AT: new Date(),
                },
            ],
        });
        const sut = new OracleIdempotencyStore(db as unknown as ConnectionProvider, baseConfig());

        // Act
        const outcome = await sut.claim('key-1', 'fp-1');

        // Assert
        expect(outcome).toEqual({ outcome: 'replay', status: 201, body: { id: 'abc' } });
        expect(connection.execute).toHaveBeenNthCalledWith(
            3,
            expect.stringContaining('SELECT fingerprint'),
            { p_key: 'key-1' },
            {
                outFormat: oracledb.OUT_FORMAT_OBJECT,
                fetchInfo: { RESPONSE_BODY: { type: oracledb.STRING } },
            },
        );
    });

    it('reports a mismatch when ORA-00001 finds a row claimed for a different body', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({});
        connection.execute.mockRejectedValueOnce({ errorNum: 1 });
        connection.execute.mockResolvedValueOnce({
            rows: [
                {
                    FINGERPRINT: 'fp-other',
                    STATE: 'completed',
                    STATUS: 200,
                    RESPONSE_BODY: null,
                    CREATED_AT: new Date(),
                },
            ],
        });
        const sut = new OracleIdempotencyStore(db as unknown as ConnectionProvider, baseConfig());

        // Act
        const outcome = await sut.claim('key-1', 'fp-1');

        // Assert
        expect(outcome).toEqual({ outcome: 'mismatch' });
    });

    it('reports in-progress when ORA-00001 finds a row still running within its TTL', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({});
        connection.execute.mockRejectedValueOnce({ errorNum: 1 });
        connection.execute.mockResolvedValueOnce({
            rows: [
                {
                    FINGERPRINT: 'fp-1',
                    STATE: 'in_progress',
                    STATUS: null,
                    RESPONSE_BODY: null,
                    CREATED_AT: new Date(),
                },
            ],
        });
        const sut = new OracleIdempotencyStore(db as unknown as ConnectionProvider, baseConfig());

        // Act
        const outcome = await sut.claim('key-1', 'fp-1');

        // Assert
        expect(outcome).toEqual({ outcome: 'in_progress' });
    });

    it('re-claims a row abandoned past the in-progress TTL', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({});
        connection.execute.mockRejectedValueOnce({ errorNum: 1 });
        connection.execute.mockResolvedValueOnce({
            rows: [
                {
                    FINGERPRINT: 'fp-1',
                    STATE: 'in_progress',
                    STATUS: null,
                    RESPONSE_BODY: null,
                    CREATED_AT: new Date(Date.now() - 120_000),
                },
            ],
        });
        connection.execute.mockResolvedValueOnce({}); // reclaim UPDATE
        const sut = new OracleIdempotencyStore(
            db as unknown as ConnectionProvider,
            baseConfig({ 'idempotency.inProgressTtlMs': 60_000 }),
        );

        // Act
        const outcome = await sut.claim('key-1', 'fp-1');

        // Assert
        expect(outcome).toEqual({ outcome: 'claimed' });
        expect(connection.execute).toHaveBeenNthCalledWith(
            4,
            expect.stringContaining('UPDATE IDEMPOTENCY_KEYS'),
            expect.objectContaining({ p_fingerprint: 'fp-1' }),
        );
    });

    it('rethrows a driver error that is not a unique-constraint violation', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({});
        connection.execute.mockRejectedValueOnce(new Error('ORA-12345: something else'));
        const sut = new OracleIdempotencyStore(db as unknown as ConnectionProvider, baseConfig());

        // Act
        const claim = sut.claim('key-1', 'fp-1');

        // Assert
        await expect(claim).rejects.toThrow('ORA-12345');
    });

    it('completes a claim with an UPDATE carrying the status and the serialized body, tagged', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({});
        const sut = new OracleIdempotencyStore(db as unknown as ConnectionProvider, baseConfig());

        // Act
        await sut.complete('key-1', 201, { id: 'abc' });

        // Assert
        expect(db.transaction).toHaveBeenCalledWith('main', expect.any(Function), {
            tag: 'idempotency.complete',
        });
        expect(connection.execute).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE IDEMPOTENCY_KEYS'),
            {
                p_status: 201,
                p_body: JSON.stringify({ id: 'abc' }),
                p_key: 'key-1',
            },
        );
    });

    it('releases a claim with a DELETE by key, tagged', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({});
        const sut = new OracleIdempotencyStore(db as unknown as ConnectionProvider, baseConfig());

        // Act
        await sut.release('key-1');

        // Assert
        expect(db.transaction).toHaveBeenCalledWith('main', expect.any(Function), {
            tag: 'idempotency.release',
        });
        expect(connection.execute).toHaveBeenCalledWith(
            expect.stringContaining('DELETE FROM IDEMPOTENCY_KEYS'),
            {
                p_key: 'key-1',
            },
        );
    });
});
