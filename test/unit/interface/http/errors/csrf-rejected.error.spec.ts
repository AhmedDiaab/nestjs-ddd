import { CsrfRejectedError } from '@interface/http/errors';

describe('CsrfRejectedError', () => {
    it('presents as 403 with code CSRF_REJECTED', () => {
        // Arrange
        const error = new CsrfRejectedError();

        // Act
        const problem = error.toProblem();

        // Assert
        expect(problem).toMatchObject({ kind: 'forbidden', code: 'CSRF_REJECTED' });
    });
});
