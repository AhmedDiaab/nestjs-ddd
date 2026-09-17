import { ConflictError } from '@application/errors';
import type { LoggerPort } from '@application/ports';
import { databaseConfigSchema } from '@infrastructure/config/schemas';
import { PoolManager } from '@infrastructure/database/connection';
import { AggregateDbHealthError, UnsupportedDialectError } from '@infrastructure/database/errors';
import oracledb from 'oracledb';

jest.mock('oracledb', () => {
    const actual = jest.requireActual<Record<string, unknown>>('oracledb');
    return {
        __esModule: true,
        default: { ...actual, createPool: jest.fn(), thin: true, initOracleClient: jest.fn() },
    };
});

const createPoolMock = oracledb.createPool as unknown as jest.Mock;

const config = (sources: unknown[], health: Record<string, unknown> = {}) =>
    databaseConfigSchema.parse({ sources, health: { jitterMs: 0, ...health } });

const oracle = { key: 'main', dialect: 'oracle', connectString: 'h/s', user: 'u', password: 'p' };
const postgres = {
    key: 'reports',
    dialect: 'postgres',
    connectionUrl: 'postgres://u:p@h:5432/db',
};

describe('PoolManager', () => {
    const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    let connection: {
        ping: jest.Mock;
        close: jest.Mock;
        execute: jest.Mock;
        commit: jest.Mock;
        rollback: jest.Mock;
    };
    let pool: { getConnection: jest.Mock; close: jest.Mock };
    let sut: PoolManager;

    beforeEach(() => {
        connection = {
            ping: jest.fn(() => Promise.resolve()),
            close: jest.fn(() => Promise.resolve()),
            execute: jest.fn(() => Promise.resolve({ rows: [] })),
            commit: jest.fn(() => Promise.resolve()),
            rollback: jest.fn(() => Promise.resolve()),
        };
        pool = {
            getConnection: jest.fn(() => Promise.resolve(connection)),
            close: jest.fn(() => Promise.resolve()),
        };
        createPoolMock.mockResolvedValue(pool);
        sut = new PoolManager(logger as unknown as LoggerPort);
    });

    afterEach(() => jest.clearAllMocks());

    it('creates one pool per oracle source with mapped attributes', async () => {
        // Arrange
        const databaseConfig = config([oracle, postgres]);

        // Act
        await sut.init(databaseConfig);

        // Assert
        expect(createPoolMock).toHaveBeenCalledTimes(1);
        expect(createPoolMock).toHaveBeenCalledWith(
            expect.objectContaining({ poolAlias: 'main', connectString: 'h/s' }),
        );
        expect(sut.hasSource('main')).toBe(true);
        expect(sut.getDialect('reports')).toBe('postgres');
    });

    it('placeholder dialects throw UnsupportedDialectError when used', async () => {
        // Arrange
        await sut.init(config([oracle, postgres]));

        // Act
        const call = sut.withConnection('reports', () => Promise.resolve());

        // Assert
        await expect(call).rejects.toBeInstanceOf(UnsupportedDialectError);
    });

    it('pingAll skips placeholder dialects that are not required', async () => {
        // Arrange
        await sut.init(config([oracle, postgres]));

        // Act
        const ping = sut.pingAll({ retries: 0, jitterMs: 0 });

        // Assert
        await expect(ping).resolves.toBeUndefined();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('skipped'),
            expect.objectContaining({ sourceKey: 'reports' }),
        );
    });

    it('pingAll fails when a required source is a placeholder', async () => {
        // Arrange
        await sut.init(config([oracle, postgres]));

        // Act
        const ping = sut.pingAll({ retries: 0, jitterMs: 0, requiredSet: new Set(['reports']) });

        // Assert
        await expect(ping).rejects.toBeInstanceOf(AggregateDbHealthError);
    });

    it('pingAll fails when a required oracle source cannot be reached', async () => {
        // Arrange
        await sut.init(config([oracle]));
        connection.ping.mockRejectedValue(new Error('down'));

        // Act
        const ping = sut.pingAll({ retries: 0, jitterMs: 0 });

        // Assert
        await expect(ping).rejects.toBeInstanceOf(AggregateDbHealthError);
    });

    it('health reports per source without throwing', async () => {
        // Arrange
        await sut.init(config([oracle, postgres]));

        // Act
        const health = await sut.health(1000);

        // Assert
        expect(health).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ sourceKey: 'main', ok: true, implemented: true }),
                expect.objectContaining({ sourceKey: 'reports', ok: false, implemented: false }),
            ]),
        );
    });

    it('closes all pools on module destroy', async () => {
        // Arrange
        await sut.init(config([oracle]));

        // Act
        await sut.onModuleDestroy();

        // Assert
        expect(pool.close).toHaveBeenCalledWith(10);
    });

    describe('runInTransaction', () => {
        type Executor = { execute: (sql: string) => Promise<unknown> };
        const write = (sql: string) => (conn: Executor) => conn.execute(sql);

        beforeEach(async () => {
            await sut.init(config([oracle]));
        });

        it('shares one connection and commits once for calls made inside the work', async () => {
            // Arrange
            const work = async () => {
                await sut.withConnection('main', write('INSERT 1'));
                await sut.transaction('main', write('INSERT 2'));
                return 'done';
            };

            // Act
            const result = await sut.runInTransaction('main', work, { contextUser: 'alice' });

            // Assert
            expect(result).toBe('done');
            expect(pool.getConnection).toHaveBeenCalledTimes(1);
            expect(connection.execute).toHaveBeenCalledTimes(2);
            expect(connection.commit).toHaveBeenCalledTimes(1);
            expect(connection.rollback).not.toHaveBeenCalled();
        });

        it('rolls back everything when the work throws', async () => {
            // Arrange
            const work = async () => {
                await sut.transaction('main', write('INSERT 1'));
                throw new Error('second write failed');
            };

            // Act
            const run = sut.runInTransaction('main', work);

            // Assert
            await expect(run).rejects.toThrow('second write failed');
            expect(connection.commit).not.toHaveBeenCalled();
            expect(connection.rollback).toHaveBeenCalledTimes(1);
        });

        it('joins an outer unit instead of opening a nested transaction', async () => {
            // Arrange
            const inner = () => sut.transaction('main', write('INSERT inner'));
            const outer = () => sut.runInTransaction('main', inner);

            // Act
            await sut.runInTransaction('main', outer);

            // Assert
            expect(pool.getConnection).toHaveBeenCalledTimes(1);
            expect(connection.commit).toHaveBeenCalledTimes(1);
        });

        it('maps driver errors from joined calls like normal calls', async () => {
            // Arrange
            const duplicate = Object.assign(new Error('ORA-00001: unique constraint'), {
                code: 'ORA-00001',
            });
            let seen: unknown;
            const work = async () => {
                try {
                    await sut.transaction('main', () => Promise.reject(duplicate));
                } catch (e) {
                    seen = e;
                }
            };

            // Act
            await sut.runInTransaction('main', work);

            // Assert
            expect(seen).toBeInstanceOf(ConflictError);
        });

        it('stops sharing the connection once the unit has finished', async () => {
            // Arrange
            await sut.runInTransaction('main', () => Promise.resolve());

            // Act
            await sut.withConnection('main', write('SELECT after'));

            // Assert
            expect(pool.getConnection).toHaveBeenCalledTimes(2);
        });
    });
});
