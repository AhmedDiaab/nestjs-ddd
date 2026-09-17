/**
 * Live Oracle checks for OracleClient. Skipped unless ORACLE_IT_PASSWORD is set.
 *
 *   ORACLE_IT_PASSWORD=... pnpm test:oracle
 *
 * Optional: ORACLE_IT_USER (default app), ORACLE_IT_CONNECT_STRING (default localhost:1521/FREEPDB1).
 * The user needs CREATE TABLE (the docker-compose APP_USER has it).
 */
import { ConflictError } from '@application/errors';
import type { LoggerPort } from '@application/ports';
import { databaseConfigSchema, type OracleSourceConfig } from '@infrastructure/config/schemas';
import { OracleClient, toPoolAttributes } from '@infrastructure/database/clients';
import oracledb, { type Connection, type Pool } from 'oracledb';

const password = process.env.ORACLE_IT_PASSWORD;
const describeLive = password ? describe : describe.skip;

type Row = Record<string, unknown>;

const CURRENT_SESSION_SQL = `SELECT SYS_CONTEXT('USERENV', 'SID') AS SID,
       SYS_CONTEXT('USERENV', 'CLIENT_IDENTIFIER') AS CLIENT_ID
  FROM DUAL`;

async function currentSession(conn: Connection): Promise<{ sid: string; clientId: unknown }> {
    const result = await conn.execute<Row>(CURRENT_SESSION_SQL, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
    });
    const row = result.rows![0];
    return { sid: String(row.SID), clientId: row.CLIENT_ID };
}

describeLive('OracleClient (live Oracle)', () => {
    const table = `IT_ORACLE_CLIENT_${Date.now()}`;
    const warn = jest.fn();
    const logger: LoggerPort = { debug: jest.fn(), info: jest.fn(), warn, error: jest.fn() };
    let pool: Pool;
    let source: OracleSourceConfig;
    let sut: OracleClient;

    beforeAll(async () => {
        const config = databaseConfigSchema.parse({
            sources: [
                {
                    key: 'it',
                    dialect: 'oracle',
                    connectString:
                        process.env.ORACLE_IT_CONNECT_STRING ?? 'localhost:1521/FREEPDB1',
                    user: process.env.ORACLE_IT_USER ?? 'app',
                    password,
                    // one session, so every call reuses the connection the previous call released
                    poolMin: 1,
                    poolMax: 1,
                    contextUser: { enabled: true, required: false, maxLength: 64 },
                },
            ],
            health: {},
        });
        source = config.sources[0] as OracleSourceConfig;
        pool = await oracledb.createPool({ ...toPoolAttributes(source), poolAlias: undefined });
        sut = new OracleClient(pool, source, logger);

        await sut.withConnection((conn: Connection) =>
            conn.execute(`CREATE TABLE ${table} (ID NUMBER PRIMARY KEY, NAME VARCHAR2(50))`),
        );
    });

    afterAll(async () => {
        if (!pool) return;
        await sut
            .withConnection((conn: Connection) => conn.execute(`DROP TABLE ${table} PURGE`))
            .catch(() => undefined);
        await pool.close(0);
    });

    it('pings', async () => {
        await expect(sut.ping(3000)).resolves.toBeUndefined();
    });

    it('sets CLIENT_IDENTIFIER for the call and clears it before the session is reused', async () => {
        const inside = await sut.withConnection(currentSession, { contextUser: 'it-alice' });
        const next = await sut.withConnection(currentSession);

        expect(inside.clientId).toBe('it-alice');
        expect(next.sid).toBe(inside.sid); // same pooled session
        expect(next.clientId).toBeNull();
    });

    it('clears CLIENT_IDENTIFIER when the callback throws', async () => {
        let sid = '';
        await expect(
            sut.withConnection(
                async (conn: Connection) => {
                    sid = (await currentSession(conn)).sid;
                    throw new Error('boom');
                },
                { contextUser: 'it-bob' },
            ),
        ).rejects.toThrow('boom');

        const next = await sut.withConnection(currentSession);
        expect(next.sid).toBe(sid);
        expect(next.clientId).toBeNull();
    });

    it('truncates the context user to maxLength bytes', async () => {
        const inside = await sut.withConnection(currentSession, { contextUser: 'x'.repeat(100) });
        expect(inside.clientId).toBe('x'.repeat(64));
    });

    it('commits a transaction', async () => {
        await sut.transaction((conn: Connection) =>
            conn.execute(`INSERT INTO ${table} (ID, NAME) VALUES (:id, :name)`, {
                id: 1,
                name: 'committed',
            }),
        );

        const count = await sut.withConnection((conn: Connection) =>
            conn.execute<Row>(
                `SELECT COUNT(*) AS N FROM ${table} WHERE ID = :id`,
                { id: 1 },
                {
                    outFormat: oracledb.OUT_FORMAT_OBJECT,
                },
            ),
        );
        expect(count.rows![0].N).toBe(1);
    });

    it('rolls back a transaction when the callback throws', async () => {
        await expect(
            sut.transaction(async (conn: Connection) => {
                await conn.execute(`INSERT INTO ${table} (ID, NAME) VALUES (:id, :name)`, {
                    id: 2,
                    name: 'rolled back',
                });
                throw new Error('abort');
            }),
        ).rejects.toThrow('abort');

        const count = await sut.withConnection((conn: Connection) =>
            conn.execute<Row>(
                `SELECT COUNT(*) AS N FROM ${table} WHERE ID = :id`,
                { id: 2 },
                {
                    outFormat: oracledb.OUT_FORMAT_OBJECT,
                },
            ),
        );
        expect(count.rows![0].N).toBe(0);
    });

    it('maps a unique constraint violation (ORA-00001) to ConflictError', async () => {
        await expect(
            sut.transaction((conn: Connection) =>
                conn.execute(`INSERT INTO ${table} (ID, NAME) VALUES (:id, :name)`, {
                    id: 1,
                    name: 'duplicate',
                }),
            ),
        ).rejects.toBeInstanceOf(ConflictError);
    });

    it('never logged a failed context clear', () => {
        expect(warn).not.toHaveBeenCalledWith('db.context.clear.failed', expect.anything());
    });
});
