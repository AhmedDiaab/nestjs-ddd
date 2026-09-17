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
        // Arrange
        const timeoutMs = 3000;

        // Act
        const ping = sut.ping(timeoutMs);

        // Assert
        await expect(ping).resolves.toBeUndefined();
    });

    it('sets CLIENT_IDENTIFIER for the call and clears it before the session is reused', async () => {
        // Arrange
        const contextUser = 'it-alice';

        // Act
        const inside = await sut.withConnection(currentSession, { contextUser });
        const next = await sut.withConnection(currentSession);

        // Assert
        expect(inside.clientId).toBe(contextUser);
        expect(next.sid).toBe(inside.sid); // same pooled session
        expect(next.clientId).toBeNull();
    });

    it('clears CLIENT_IDENTIFIER when the callback throws', async () => {
        // Arrange
        let sid = '';
        const failingCall = async (conn: Connection) => {
            sid = (await currentSession(conn)).sid;
            throw new Error('boom');
        };

        // Act
        const call = sut.withConnection(failingCall, { contextUser: 'it-bob' });
        await expect(call).rejects.toThrow('boom');
        const next = await sut.withConnection(currentSession);

        // Assert
        expect(next.sid).toBe(sid);
        expect(next.clientId).toBeNull();
    });

    it('truncates the context user to maxLength bytes', async () => {
        // Arrange
        const contextUser = 'x'.repeat(100);

        // Act
        const inside = await sut.withConnection(currentSession, { contextUser });

        // Assert
        expect(inside.clientId).toBe('x'.repeat(64));
    });

    it('commits a transaction', async () => {
        // Arrange
        const row = { id: 1, name: 'committed' };

        // Act
        await sut.transaction((conn: Connection) => insertRow(conn, row));

        // Assert
        expect(await countRows(row.id)).toBe(1);
    });

    it('rolls back a transaction when the callback throws', async () => {
        // Arrange
        const row = { id: 2, name: 'rolled back' };
        const failingWrite = async (conn: Connection) => {
            await insertRow(conn, row);
            throw new Error('abort');
        };

        // Act
        const write = sut.transaction(failingWrite);

        // Assert
        await expect(write).rejects.toThrow('abort');
        expect(await countRows(row.id)).toBe(0);
    });

    it('maps a unique constraint violation (ORA-00001) to ConflictError', async () => {
        // Arrange
        const duplicate = { id: 3, name: 'duplicate' };
        await sut.transaction((conn: Connection) => insertRow(conn, duplicate));

        // Act
        const write = sut.transaction((conn: Connection) => insertRow(conn, duplicate));

        // Assert
        await expect(write).rejects.toBeInstanceOf(ConflictError);
    });

    it('never logged a failed context clear', () => {
        // Arrange: the calls made by the tests above

        // Act
        const clearFailures = warn.mock.calls.filter(
            ([event]) => event === 'db.context.clear.failed',
        );

        // Assert
        expect(clearFailures).toHaveLength(0);
    });

    function insertRow(conn: Connection, row: { id: number; name: string }) {
        return conn.execute(`INSERT INTO ${table} (ID, NAME) VALUES (:id, :name)`, row);
    }

    function countRows(id: number): Promise<unknown> {
        return sut.withConnection(async (conn: Connection) => {
            const result = await conn.execute<Row>(
                `SELECT COUNT(*) AS N FROM ${table} WHERE ID = :id`,
                { id },
                { outFormat: oracledb.OUT_FORMAT_OBJECT },
            );
            return result.rows![0].N;
        });
    }
});
