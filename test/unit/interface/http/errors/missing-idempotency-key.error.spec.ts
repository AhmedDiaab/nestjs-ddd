import { MissingIdempotencyKeyError } from '@interface/http/errors';

describe('MissingIdempotencyKeyError', () => {
    it('presents as 400 with code MISSING_IDEMPOTENCY_KEY', () => {
        // Arrange
        const error = new MissingIdempotencyKeyError('idempotency-key');

        // Act
        const problem = error.toProblem();

        // Assert
        expect(problem).toMatchObject({ kind: 'bad_request', code: 'MISSING_IDEMPOTENCY_KEY' });
    });
});
