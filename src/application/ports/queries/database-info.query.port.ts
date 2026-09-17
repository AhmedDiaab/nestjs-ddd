import { createToken } from '@shared';
import type { QueryOptions } from './query-options';

/**
 * Example query port: shows how a use case reads from the database
 * without knowing the driver, the source key, or connection handling.
 */
export type DatabaseInfo = {
    databaseName: string;
    sessionUser: string;
    /** CLIENT_IDENTIFIER seen by the database for this query (the context user). */
    clientIdentifier: string | null;
};

export interface DatabaseInfoQueryPort {
    getInfo(options?: QueryOptions): Promise<DatabaseInfo>;
}

export const DatabaseInfoQueryPortToken =
    createToken<DatabaseInfoQueryPort>('DatabaseInfoQueryPort');
