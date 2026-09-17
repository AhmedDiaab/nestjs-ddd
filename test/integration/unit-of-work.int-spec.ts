/**
 * Live Oracle checks for DatabaseUnitOfWork over PoolManager. Skipped unless ORACLE_IT_PASSWORD is set.
 * Same env as oracle.client.int-spec.ts.
 */
import { NotFoundError } from '@application/errors';
import type { LoggerPort } from '@application/ports';
import { databaseConfigSchema } from '@infrastructure/config/schemas';
import { PoolManager } from '@infrastructure/database/connection';
import { DatabaseUnitOfWork } from '@infrastructure/database/unit-of-work';
import { Result } from '@shared';
import oracledb, { type Connection } from 'oracledb';

const password = process.env.ORACLE_IT_PASSWORD;
const describeLive = password ? describe : describe.skip;

describeLive('DatabaseUnitOfWork (live Oracle)', () => {
    const table = `IT_UNIT_OF_WORK_${Date.now()}`;
    const logger: LoggerPort = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const db = new PoolManager(logger);
    const sut = new DatabaseUnitOfWork(db);

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
                        poolMin: 1,
                        poolMax: 2,
                    },
                ],
                health: {},
            }),
        );
        await db.withConnection('main', (conn: Connection) =>
            conn.execute(`CREATE TABLE ${table} (ID NUMBER PRIMARY KEY, WRITTEN_BY VARCHAR2(64))`),
        );
    });

    afterAll(async () => {
        await db
            .withConnection('main', (conn: Connection) => conn.execute(`DROP TABLE ${table} PURGE`))
            .catch(() => undefined);
        await db.onModuleDestroy();
    });

    /** What a repository does: its own transaction, unaware of the unit of work. */
    const repositoryInsert = (id: number) =>
        db.transaction('main', (conn: Connection) =>
            conn.execute(
                `INSERT INTO ${table} (ID, WRITTEN_BY)
                 VALUES (:id, SYS_CONTEXT('USERENV', 'CLIENT_IDENTIFIER'))`,
                { id },
            ),
        );

    const rows = (ids: number[]) =>
        db.withConnection('main', async (conn: Connection) => {
            const result = await conn.execute<{ ID: number; WRITTEN_BY: string | null }>(
                `SELECT ID, WRITTEN_BY FROM ${table} WHERE ID IN (${ids.map((_, i) => `:id${i}`).join(', ')}) ORDER BY ID`,
                Object.fromEntries(ids.map((id, i) => [`id${i}`, id])),
                { outFormat: oracledb.OUT_FORMAT_OBJECT },
            );
            return result.rows ?? [];
        });

    it('commits all repository writes together, attributed to the actor', async () => {
        // Arrange
        const work = async () => {
            await repositoryInsert(1);
            await repositoryInsert(2);
            return Result.ok('saved');
        };

        // Act
        const result = await sut.run(work, { actor: 'it-alice' });

        // Assert
        expect(result).toEqual(Result.ok('saved'));
        expect(await rows([1, 2])).toEqual([
            { ID: 1, WRITTEN_BY: 'it-alice' },
            { ID: 2, WRITTEN_BY: 'it-alice' },
        ]);
    });

    it('rolls back earlier writes when a later step fails with a Result', async () => {
        // Arrange
        const work = async () => {
            await repositoryInsert(3);
            return Result.err(new NotFoundError('related record missing'));
        };

        // Act
        const result = await sut.run(work, { actor: 'it-bob' });

        // Assert
        expect(result.ok).toBe(false);
        expect(await rows([3])).toEqual([]);
    });

    it('rolls back earlier writes when a later step throws', async () => {
        // Arrange
        const work = async () => {
            await repositoryInsert(4);
            await repositoryInsert(4); // ORA-00001
        };

        // Act
        const run = sut.run(work);

        // Assert
        await expect(run).rejects.toThrow();
        expect(await rows([4])).toEqual([]);
    });
});
