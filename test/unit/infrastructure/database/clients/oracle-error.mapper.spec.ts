import { ConflictError } from '@application/errors';
import { mapOracleError } from '@infrastructure/database/clients';
import { DatabaseConnectionError, DatabaseExecutionError } from '@infrastructure/database/errors';

const oraError = (code: string) => Object.assign(new Error(code), { code });

describe('mapOracleError', () => {
    it('maps ORA-00001 to ConflictError', () => {
        // Arrange
        const error = oraError('ORA-00001');

        // Act
        const mapped = mapOracleError(error, 'main');

        // Assert
        expect(mapped).toBeInstanceOf(ConflictError);
    });

    it.each(['NJS-040', 'NJS-500', 'ORA-03113', 'DPI-1080', 'ORA-12170'])(
        'maps %s to DatabaseConnectionError',
        (code) => {
            // Arrange
            const error = oraError(code);

            // Act
            const mapped = mapOracleError(error, 'main');

            // Assert
            expect(mapped).toBeInstanceOf(DatabaseConnectionError);
        },
    );

    it('maps other ORA errors to DatabaseExecutionError keeping the code', () => {
        // Arrange
        const error = oraError('ORA-20101');

        // Act
        const mapped = mapOracleError(error, 'main', 'site.delete');

        // Assert
        expect(mapped).toBeInstanceOf(DatabaseExecutionError);
        expect(mapped).toMatchObject({ code: 'ORA-20101', sqlTag: 'site.delete' });
    });

    it('derives the code from errorNum', () => {
        // Arrange
        const error = Object.assign(new Error('x'), { errorNum: 1 });

        // Act
        const mapped = mapOracleError(error, 'main');

        // Assert
        expect(mapped).toBeInstanceOf(ConflictError);
    });

    it('passes non-driver errors through untouched', () => {
        // Arrange
        const error = new ConflictError('already mapped');

        // Act
        const mapped = mapOracleError(error, 'main');

        // Assert
        expect(mapped).toBe(error);
    });
});
