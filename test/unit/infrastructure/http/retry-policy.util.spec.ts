import {
    isIdempotent,
    isRetryableStatus,
    parseRetryAfter,
    retryDelayMs,
} from '@infrastructure/http';

describe('retry policy', () => {
    describe('isIdempotent', () => {
        it.each(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'] as const)(
            'treats %s as safe to repeat',
            (method) => {
                // Arrange: no explicit flag

                // Act
                const retryable = isIdempotent(method);

                // Assert
                expect(retryable).toBe(true);
            },
        );

        it.each(['POST', 'PATCH'] as const)('does not repeat %s unless told to', (method) => {
            // Arrange: no explicit flag

            // Act
            const retryable = isIdempotent(method);

            // Assert
            expect(retryable).toBe(false);
        });

        it('lets the caller mark a POST the upstream deduplicates', () => {
            // Arrange: an upstream with an idempotency key

            // Act
            const retryable = isIdempotent('POST', true);

            // Assert
            expect(retryable).toBe(true);
        });

        it('lets the caller opt a GET out of retries', () => {
            // Arrange: a read with side effects upstream

            // Act
            const retryable = isIdempotent('GET', false);

            // Assert
            expect(retryable).toBe(false);
        });
    });

    describe('isRetryableStatus', () => {
        it.each([408, 425, 429, 500, 502, 503, 504])('repeats %d', (status) => {
            // Arrange: the upstream said "not now"

            // Act
            const retry = isRetryableStatus(status);

            // Assert
            expect(retry).toBe(true);
        });

        it.each([200, 400, 401, 403, 404, 409, 422, 501])('does not repeat %d', (status) => {
            // Arrange: repeating cannot change the answer

            // Act
            const retry = isRetryableStatus(status);

            // Assert
            expect(retry).toBe(false);
        });
    });

    describe('parseRetryAfter', () => {
        it('reads a delay given in seconds', () => {
            // Arrange
            const header = '2';

            // Act
            const ms = parseRetryAfter(header);

            // Assert
            expect(ms).toBe(2000);
        });

        it('reads a delay given as an HTTP date', () => {
            // Arrange
            const now = Date.parse('2026-01-01T00:00:00Z');
            const header = new Date(now + 3000).toUTCString();

            // Act
            const ms = parseRetryAfter(header, now);

            // Assert
            expect(ms).toBe(3000);
        });

        it('never returns a negative wait for a date in the past', () => {
            // Arrange
            const now = Date.parse('2026-01-01T00:00:00Z');
            const header = new Date(now - 60_000).toUTCString();

            // Act
            const ms = parseRetryAfter(header, now);

            // Assert
            expect(ms).toBe(0);
        });

        it('ignores a header it cannot parse', () => {
            // Arrange
            const header = 'soon';

            // Act
            const ms = parseRetryAfter(header);

            // Assert
            expect(ms).toBeUndefined();
        });
    });

    describe('retryDelayMs', () => {
        const options = { baseMs: 200, jitterMs: 0, maxDelayMs: 5000 };

        it('doubles the wait per attempt', () => {
            // Arrange: attempts 0, 1, 2

            // Act
            const waits = [0, 1, 2].map((attempt) => retryDelayMs({ ...options, attempt }));

            // Assert
            expect(waits).toEqual([200, 400, 800]);
        });

        it('caps the wait', () => {
            // Arrange: an attempt whose backoff exceeds the cap

            // Act
            const wait = retryDelayMs({ ...options, attempt: 10 });

            // Assert
            expect(wait).toBe(5000);
        });

        it('prefers the upstream’s Retry-After over its own backoff', () => {
            // Arrange
            const retryAfterMs = 1500;

            // Act
            const wait = retryDelayMs({ ...options, attempt: 0, retryAfterMs });

            // Assert
            expect(wait).toBe(1500);
        });

        it('still caps a Retry-After that asks for too long', () => {
            // Arrange
            const retryAfterMs = 600_000;

            // Act
            const wait = retryDelayMs({ ...options, attempt: 0, retryAfterMs });

            // Assert
            expect(wait).toBe(5000);
        });

        it('adds jitter within the configured window', () => {
            // Arrange
            const random = jest.spyOn(Math, 'random').mockReturnValue(0.5);

            // Act
            const wait = retryDelayMs({ ...options, attempt: 0, jitterMs: 100 });

            // Assert: 200 backoff + 50 jitter, so two instances don't retry in lockstep
            expect(wait).toBe(250);
            random.mockRestore();
        });
    });
});
