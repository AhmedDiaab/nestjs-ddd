import { ConflictError } from '@application/errors';
import { mapOracleError } from '@infrastructure/database/clients';
import { DatabaseConnectionError, DatabaseExecutionError } from '@infrastructure/database/errors';

const oraError = (code: string) => Object.assign(new Error(code), { code });

describe('mapOracleError', () => {
    it('maps ORA-00001 to ConflictError', () => {
        expect(mapOracleError(oraError('ORA-00001'), 'main')).toBeInstanceOf(ConflictError);
    });

    it.each(['NJS-040', 'NJS-500', 'ORA-03113', 'DPI-1080', 'ORA-12170'])(
        'maps %s to DatabaseConnectionError',
        (code) => {
            expect(mapOracleError(oraError(code), 'main')).toBeInstanceOf(DatabaseConnectionError);
        },
    );

    it('maps other ORA errors to DatabaseExecutionError keeping the code', () => {
        const mapped = mapOracleError(oraError('ORA-20101'), 'main', 'site.delete');
        expect(mapped).toBeInstanceOf(DatabaseExecutionError);
        expect(mapped).toMatchObject({ code: 'ORA-20101', sqlTag: 'site.delete' });
    });

    it('derives the code from errorNum', () => {
        const mapped = mapOracleError(Object.assign(new Error('x'), { errorNum: 1 }), 'main');
        expect(mapped).toBeInstanceOf(ConflictError);
    });

    it('passes non-driver errors through untouched', () => {
        const error = new ConflictError('already mapped');
        expect(mapOracleError(error, 'main')).toBe(error);
    });
});
