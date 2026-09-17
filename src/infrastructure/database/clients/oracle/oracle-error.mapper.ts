import { ConflictError } from '@application/errors';
import { DatabaseConnectionError, DatabaseExecutionError } from '@infrastructure/database/errors';

type OracleLikeError = { code?: string; errorNum?: number; message?: string };

/** Connection-level failures: pool exhausted/queue timeout, network, dead session. */
const CONNECTION_CODES = new Set([
    'NJS-040', // queue timeout
    'NJS-076', // queueMax reached
    'NJS-500', // connection to the database was closed
    'NJS-501',
    'NJS-503', // connection refused
    'NJS-510', // connect timeout
    'NJS-521',
    'DPI-1010', // not connected
    'DPI-1080', // connection closed by ORA-3113
    'ORA-03113',
    'ORA-03114',
    'ORA-03135',
    'ORA-12170',
    'ORA-12514',
    'ORA-12541',
    'ORA-12543',
    'ORA-12545',
]);

function isOracleLikeError(error: unknown): error is OracleLikeError {
    return typeof error === 'object' && error !== null && ('code' in error || 'errorNum' in error);
}

/**
 * Maps driver errors to application errors. Already-mapped app errors pass through.
 * The ORA code is kept in `details` for logs; presenters never send details to clients.
 */
export function mapOracleError(error: unknown, sourceKey: string, tag?: string): unknown {
    if (!isOracleLikeError(error)) return error;

    const code =
        error.code ??
        (error.errorNum ? `ORA-${String(error.errorNum).padStart(5, '0')}` : undefined);
    if (!code) return error;

    if (code === 'ORA-00001') {
        return new ConflictError('Duplicate value', { code, sourceKey, tag });
    }

    if (CONNECTION_CODES.has(code)) {
        return new DatabaseConnectionError(sourceKey, error);
    }

    return new DatabaseExecutionError(sourceKey, tag, error, code);
}
