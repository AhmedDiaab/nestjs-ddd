import { ConflictError, UnauthorizedError } from '@application/errors';
import type { LoggerPort } from '@application/ports';
import { OracleClient } from '@infrastructure/database/clients';
import { DatabaseConnectionError, DatabaseExecutionError } from '@infrastructure/database/errors';
import type { Connection, Pool } from 'oracledb';
import { oracleSource } from '../../../../fixtures/database/oracle-source';

type ConnectionMock = {
    execute: jest.Mock;
    close: jest.Mock;
    ping: jest.Mock;
    commit: jest.Mock;
    rollback: jest.Mock;
    clientId?: string;
    callTimeout?: number;
    /** clientId value at each round trip, to prove what the server saw */
    trips: { call: string; clientId?: string }[];
};

function createConnection(): ConnectionMock {
    const conn: ConnectionMock = {
        trips: [],
        execute: jest.fn(() => {
            conn.trips.push({ call: 'execute', clientId: conn.clientId });
            return Promise.resolve({ rows: [] });
        }),
        ping: jest.fn(() => {
            conn.trips.push({ call: 'ping', clientId: conn.clientId });
            return Promise.resolve();
        }),
        close: jest.fn(() => Promise.resolve()),
        commit: jest.fn(() => Promise.resolve()),
        rollback: jest.fn(() => Promise.resolve()),
    };
    return conn;
}

describe('OracleClient', () => {
    let connection: ConnectionMock;
    let pool: { getConnection: jest.Mock; close: jest.Mock; getStatistics: jest.Mock };
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const createClient = (overrides: Record<string, unknown> = {}) =>
        new OracleClient(
            pool as unknown as Pool,
            oracleSource(overrides),
            logger as unknown as LoggerPort,
        );

    beforeEach(() => {
        connection = createConnection();
        pool = {
            getConnection: jest.fn(() => Promise.resolve(connection)),
            close: jest.fn(() => Promise.resolve()),
            getStatistics: jest.fn(),
        };
    });

    afterEach(() => jest.clearAllMocks());

    const selectOne = (conn: Connection) => conn.execute('SELECT 1 FROM DUAL');

    describe('context user', () => {
        it('sets CLIENT_IDENTIFIER without an extra DBMS_SESSION round trip', async () => {
            // Arrange
            const sut = createClient();

            // Act
            await sut.withConnection(selectOne, { contextUser: 'alice' });

            // Assert
            expect(connection.trips[0]).toEqual({ call: 'execute', clientId: 'alice' });
            const executedSql = (connection.execute.mock.calls as unknown[][]).map((c) =>
                String(c[0]),
            );
            expect(executedSql.some((sql) => sql.includes('DBMS_SESSION'))).toBe(false);
        });

        it('clears the identifier with a flushing ping before releasing the connection', async () => {
            // Arrange
            const sut = createClient();

            // Act
            await sut.withConnection(selectOne, { contextUser: 'alice' });

            // Assert
            expect(connection.trips.at(-1)).toEqual({ call: 'ping', clientId: '' });
            expect(connection.close).toHaveBeenCalledWith({ drop: false });
            expect(connection.ping.mock.invocationCallOrder[0]).toBeLessThan(
                connection.close.mock.invocationCallOrder[0],
            );
        });

        it('clears the identifier even when the query fails', async () => {
            // Arrange
            const sut = createClient();
            connection.execute.mockRejectedValueOnce(
                Object.assign(new Error('ORA-20101: boom'), { code: 'ORA-20101' }),
            );

            // Act
            const call = sut.withConnection((conn: Connection) => conn.execute('BEGIN x; END;'), {
                contextUser: 'alice',
            });

            // Assert
            await expect(call).rejects.toBeInstanceOf(DatabaseExecutionError);
            expect(connection.clientId).toBe('');
            expect(connection.ping).toHaveBeenCalled();
            expect(connection.close).toHaveBeenCalledWith({ drop: false });
        });

        it('drops the connection when the clear cannot be flushed', async () => {
            // Arrange
            const sut = createClient();
            connection.ping.mockRejectedValueOnce(new Error('NJS-500'));

            // Act
            await sut.withConnection(selectOne, { contextUser: 'alice' });

            // Assert
            expect(connection.close).toHaveBeenCalledWith({ drop: true });
            expect(logger.warn).toHaveBeenCalledWith('db.context.clear.failed', expect.any(Object));
        });

        it('does not touch clientId or ping when no context user is given', async () => {
            // Arrange
            const sut = createClient();

            // Act
            await sut.withConnection(selectOne);

            // Assert
            expect(connection.clientId).toBeUndefined();
            expect(connection.ping).not.toHaveBeenCalled();
            expect(connection.close).toHaveBeenCalledWith({ drop: false });
        });

        it('accepts the deprecated username option', async () => {
            // Arrange
            const sut = createClient();

            // Act
            await sut.withConnection(selectOne, { username: 'bob' });

            // Assert
            expect(connection.trips[0].clientId).toBe('bob');
        });

        it('rejects calls without a user when contextUser.required is set, before borrowing', async () => {
            // Arrange
            const sut = createClient({ contextUser: { required: true } });

            // Act
            const call = sut.withConnection(() => Promise.resolve());

            // Assert
            await expect(call).rejects.toBeInstanceOf(UnauthorizedError);
            expect(pool.getConnection).not.toHaveBeenCalled();
        });

        it('ignores the user when contextUser.enabled is false', async () => {
            // Arrange
            const sut = createClient({ contextUser: { enabled: false } });

            // Act
            await sut.withConnection(() => Promise.resolve(), { contextUser: 'alice' });

            // Assert
            expect(connection.clientId).toBeUndefined();
        });

        it('truncates to maxLength bytes', async () => {
            // Arrange
            const sut = createClient({ contextUser: { maxLength: 4 } });
            const contextUser = 'ééé'; // 2 bytes each

            // Act
            await sut.withConnection(selectOne, { contextUser });

            // Assert
            expect(connection.trips[0].clientId).toBe('éé');
        });
    });

    describe('execution', () => {
        it('applies per-source execute defaults, letting call options win', async () => {
            // Arrange
            const sut = createClient({ fetchArraySize: 500, maxRows: 10 });

            // Act
            await sut.withConnection((conn: Connection) =>
                conn.execute('SELECT 1 FROM DUAL', {}, { maxRows: 1 }),
            );

            // Assert
            expect(connection.execute).toHaveBeenCalledWith(
                'SELECT 1 FROM DUAL',
                {},
                expect.objectContaining({ fetchArraySize: 500, maxRows: 1 }),
            );
        });

        it('sets and resets callTimeout per call', async () => {
            // Arrange
            const sut = createClient({ callTimeoutMs: 0 });
            let during: number | undefined;
            const readTimeout = () => {
                during = connection.callTimeout;
                return Promise.resolve();
            };

            // Act
            await sut.withConnection(readTimeout, { callTimeoutMs: 1500 });

            // Assert
            expect(during).toBe(1500);
            expect(connection.callTimeout).toBe(0);
        });

        it('maps unique constraint violations to ConflictError', async () => {
            // Arrange
            const sut = createClient();
            connection.execute.mockRejectedValueOnce(
                Object.assign(new Error('ORA-00001'), { code: 'ORA-00001' }),
            );

            // Act
            const call = sut.withConnection((conn: Connection) => conn.execute('INSERT ...'));

            // Assert
            await expect(call).rejects.toBeInstanceOf(ConflictError);
        });

        it('wraps pool acquisition failures', async () => {
            // Arrange
            const sut = createClient();
            pool.getConnection.mockRejectedValueOnce(new Error('NJS-040'));

            // Act
            const call = sut.withConnection(() => Promise.resolve());

            // Assert
            await expect(call).rejects.toBeInstanceOf(DatabaseConnectionError);
        });

        it('warns on slow queries without logging SQL unless logSql is on', async () => {
            // Arrange
            const sut = createClient({ slowQueryMs: 1 });
            connection.execute.mockImplementationOnce(
                () => new Promise((resolve) => setTimeout(() => resolve({ rows: [] }), 5)),
            );

            // Act
            await sut.withConnection((conn: Connection) => conn.execute('SELECT secret FROM t'), {
                tag: 'demo',
            });

            // Assert
            expect(logger.warn).toHaveBeenCalledWith(
                'db.query.slow',
                expect.objectContaining({ tag: 'demo', sql: undefined }),
            );
        });
    });

    describe('transaction', () => {
        it('commits on success', async () => {
            // Arrange
            const sut = createClient();

            // Act
            await sut.transaction((conn: Connection) => conn.execute('UPDATE t SET x = 1'), {
                contextUser: 'alice',
            });

            // Assert
            expect(connection.commit).toHaveBeenCalled();
            expect(connection.rollback).not.toHaveBeenCalled();
            expect(connection.clientId).toBe('');
        });

        it('rolls back and rethrows on failure', async () => {
            // Arrange
            const sut = createClient();

            // Act
            const call = sut.transaction(() => Promise.reject(new Error('fail')));

            // Assert
            await expect(call).rejects.toThrow('fail');
            expect(connection.rollback).toHaveBeenCalled();
            expect(connection.commit).not.toHaveBeenCalled();
        });
    });

    it('pings with callTimeout and logs latency', async () => {
        // Arrange
        const sut = createClient();
        let timeoutDuringPing: number | undefined;
        connection.ping.mockImplementationOnce(() => {
            timeoutDuringPing = connection.callTimeout;
            return Promise.resolve();
        });

        // Act
        await sut.ping(2500);

        // Assert
        expect(timeoutDuringPing).toBe(2500);
        expect(logger.debug).toHaveBeenCalledWith('db.ping.ok', expect.any(Object));
    });

    it('closes the pool with the configured drain time', async () => {
        // Arrange
        const sut = createClient({ drainTimeSec: 7 });

        // Act
        await sut.close();

        // Assert
        expect(pool.close).toHaveBeenCalledWith(7);
    });
});
