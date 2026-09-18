import { IdempotencyKeyReusedError } from '@interface/http/errors';

describe('IdempotencyKeyReusedError', () => {
    it('presents as 422 with code IDEMPOTENCY_KEY_REUSED', () => {
        // Arrange
        const error = new IdempotencyKeyReusedError();

        // Act
        const problem = error.toProblem();

        // Assert
        expect(problem).toMatchObject({ kind: 'validation', code: 'IDEMPOTENCY_KEY_REUSED' });
    });
});
