/**
 * Example repository port: shows how a use case reaches the database
 * without knowing the driver, the source key, or connection handling.
 */
export type DatabaseInfo = {
    databaseName: string;
    sessionUser: string;
    /** CLIENT_IDENTIFIER seen by the database for this query (the context user). */
    clientIdentifier: string | null;
};

export interface DatabaseInfoRepositoryPort {
    getInfo(contextUser?: string): Promise<DatabaseInfo>;
}
