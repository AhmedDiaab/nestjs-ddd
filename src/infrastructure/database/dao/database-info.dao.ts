import type { DatabaseInfo, DatabaseInfoRepositoryPort } from '@application/ports';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { DatabaseSources } from '@infrastructure/database/sources';
import oracledb, { type Connection } from 'oracledb';

type DatabaseInfoRow = {
    DATABASE_NAME: string;
    SESSION_USER: string;
    CLIENT_IDENTIFIER: string | null;
};

/**
 * Example DAO:
 * - depends on the `ConnectionProvider` contract (pools already initialised and pinged)
 * - passes the end user as `contextUser` → Oracle CLIENT_IDENTIFIER for this call only
 * - maps named columns (outFormat OBJECT) to the port type; no positional row indexes
 */
export class DatabaseInfoDao implements DatabaseInfoRepositoryPort {
    constructor(private readonly db: ConnectionProvider) {}

    getInfo(contextUser?: string): Promise<DatabaseInfo> {
        const sql = `
            SELECT
                SYS_CONTEXT('USERENV', 'DB_NAME') AS database_name,
                SYS_CONTEXT('USERENV', 'SESSION_USER') AS session_user,
                SYS_CONTEXT('USERENV', 'CLIENT_IDENTIFIER') AS client_identifier
            FROM DUAL
        `;

        return this.db.withConnection<DatabaseInfo, Connection>(
            DatabaseSources.main,
            async (connection) => {
                const { rows } = await connection.execute<DatabaseInfoRow>(
                    sql,
                    {},
                    { outFormat: oracledb.OUT_FORMAT_OBJECT },
                );
                const [row] = rows ?? [];
                return {
                    databaseName: row.DATABASE_NAME,
                    sessionUser: row.SESSION_USER,
                    clientIdentifier: row.CLIENT_IDENTIFIER,
                };
            },
            { contextUser, tag: 'databaseInfo.getInfo' },
        );
    }
}
