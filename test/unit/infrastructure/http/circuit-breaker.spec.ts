import { CircuitBreaker } from '@infrastructure/http';

const options = { failureThreshold: 3, resetMs: 1000 };

describe('CircuitBreaker', () => {
    it('lets calls through while it is closed', () => {
        // Arrange
        const sut = new CircuitBreaker(options);

        // Act
        const blocked = sut.blockedForMs();

        // Assert
        expect(blocked).toBeUndefined();
    });

    it('opens after the configured number of consecutive failures', () => {
        // Arrange: a frozen clock, or the real one advances a millisecond mid-test and the
        // remaining wait comes back as 999
        const sut = new CircuitBreaker(options, () => 0);

        // Act
        [1, 2, 3].forEach(() => sut.recordFailure());

        // Assert
        expect(sut.current()).toBe('open');
        expect(sut.blockedForMs()).toBe(1000);
    });

    it('forgets earlier failures after a success', () => {
        // Arrange
        const sut = new CircuitBreaker(options);
        sut.recordFailure();
        sut.recordFailure();

        // Act
        sut.recordSuccess();
        sut.recordFailure();

        // Assert: the counter restarted, so one more failure is not enough to open it
        expect(sut.current()).toBe('closed');
    });

    it('allows exactly one trial call once the reset window has passed', () => {
        // Arrange
        let now = 0;
        const sut = new CircuitBreaker(options, () => now);
        [1, 2, 3].forEach(() => sut.recordFailure());
        now = 1000;

        // Act
        const first = sut.blockedForMs();
        const second = sut.blockedForMs();

        // Assert
        expect(first).toBeUndefined();
        expect(second).toBe(1000);
    });

    it('closes when the trial call succeeds', () => {
        // Arrange
        let now = 0;
        const sut = new CircuitBreaker(options, () => now);
        [1, 2, 3].forEach(() => sut.recordFailure());
        now = 1000;
        sut.blockedForMs();

        // Act
        sut.recordSuccess();

        // Assert
        expect(sut.current()).toBe('closed');
        expect(sut.blockedForMs()).toBeUndefined();
    });

    it('opens again for a full window when the trial call fails', () => {
        // Arrange
        let now = 0;
        const sut = new CircuitBreaker(options, () => now);
        [1, 2, 3].forEach(() => sut.recordFailure());
        now = 1000;
        sut.blockedForMs();

        // Act
        sut.recordFailure();

        // Assert: one failure in half-open reopens it, without waiting for the threshold again
        expect(sut.current()).toBe('open');
        expect(sut.blockedForMs()).toBe(1000);
    });

    it('counts down the remaining wait while it is open', () => {
        // Arrange
        let now = 0;
        const sut = new CircuitBreaker(options, () => now);
        [1, 2, 3].forEach(() => sut.recordFailure());

        // Act
        now = 600;
        const remaining = sut.blockedForMs();

        // Assert
        expect(remaining).toBe(400);
    });
});
