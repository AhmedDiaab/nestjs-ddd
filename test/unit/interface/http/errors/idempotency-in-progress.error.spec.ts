import { IdempotencyInProgressError } from '@interface/http/errors';

describe('IdempotencyInProgressError', () => {
    it('presents as 409 with code IDEMPOTENCY_IN_PROGRESS', () => {
        // Arrange
        const error = new IdempotencyInProgressError();

        // Act
        const problem = error.toProblem();

        // Assert
        expect(problem).toMatchObject({ kind: 'conflict', code: 'IDEMPOTENCY_IN_PROGRESS' });
    });
});
