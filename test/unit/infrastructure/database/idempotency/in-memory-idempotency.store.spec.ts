import type { ConfigPort } from '@application/ports';
import { InMemoryIdempotencyStore } from '@infrastructure/database/idempotency';

const configWith = (values: Record<string, unknown>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigPort;

describe('InMemoryIdempotencyStore', () => {
    const ttlMs = 60_000;
    const inProgressTtlMs = 5_000;
    const config = configWith({
        'idempotency.ttlMs': ttlMs,
        'idempotency.inProgressTtlMs': inProgressTtlMs,
    });

    afterEach(() => jest.useRealTimers());

    it('claims a key that has never been seen', async () => {
        // Arrange
        const sut = new InMemoryIdempotencyStore(config);

        // Act
        const outcome = await sut.claim('key-1', 'fp-1');

        // Assert
        expect(outcome).toEqual({ outcome: 'claimed' });
    });

    it('replays the stored status and body once completed with the same fingerprint', async () => {
        // Arrange
        const sut = new InMemoryIdempotencyStore(config);
        await sut.claim('key-1', 'fp-1');
        await sut.complete('key-1', 201, { id: 'abc' });

        // Act
        const outcome = await sut.claim('key-1', 'fp-1');

        // Assert
        expect(outcome).toEqual({ outcome: 'replay', status: 201, body: { id: 'abc' } });
    });

    it('reports a mismatch when the same key is reused with a different body', async () => {
        // Arrange
        const sut = new InMemoryIdempotencyStore(config);
        await sut.claim('key-1', 'fp-1');
        await sut.complete('key-1', 200, { id: 'abc' });

        // Act
        const outcome = await sut.claim('key-1', 'fp-different');

        // Assert
        expect(outcome).toEqual({ outcome: 'mismatch' });
    });

    it('reports in-progress while the first call has not completed yet', async () => {
        // Arrange
        const sut = new InMemoryIdempotencyStore(config);
        await sut.claim('key-1', 'fp-1');

        // Act
        const outcome = await sut.claim('key-1', 'fp-1');

        // Assert
        expect(outcome).toEqual({ outcome: 'in_progress' });
    });

    it('re-claims an in-progress key once it is older than the in-progress TTL', async () => {
        // Arrange
        jest.useFakeTimers({ now: 0 });
        const sut = new InMemoryIdempotencyStore(config);
        await sut.claim('key-1', 'fp-1');
        jest.setSystemTime(inProgressTtlMs + 1);

        // Act
        const outcome = await sut.claim('key-1', 'fp-1');

        // Assert
        expect(outcome).toEqual({ outcome: 'claimed' });
    });

    it('re-claims a key once its overall TTL has passed, even for a different body', async () => {
        // Arrange
        jest.useFakeTimers({ now: 0 });
        const sut = new InMemoryIdempotencyStore(config);
        await sut.claim('key-1', 'fp-1');
        await sut.complete('key-1', 200, { id: 'abc' });
        jest.setSystemTime(ttlMs + 1);

        // Act
        const outcome = await sut.claim('key-1', 'fp-completely-different');

        // Assert
        expect(outcome).toEqual({ outcome: 'claimed' });
    });

    it('lets a released key be re-claimed immediately', async () => {
        // Arrange
        const sut = new InMemoryIdempotencyStore(config);
        await sut.claim('key-1', 'fp-1');
        await sut.release('key-1');

        // Act
        const outcome = await sut.claim('key-1', 'fp-anything');

        // Assert
        expect(outcome).toEqual({ outcome: 'claimed' });
    });

    it('does nothing when completing a key that was already released', async () => {
        // Arrange
        const sut = new InMemoryIdempotencyStore(config);
        await sut.claim('key-1', 'fp-1');
        await sut.release('key-1');

        // Act
        const complete = sut.complete('key-1', 200, { id: 'abc' });

        // Assert
        await expect(complete).resolves.toBeUndefined();
    });
});
