export type CircuitBreakerOptions = {
    /** Consecutive failures that open the circuit. */
    failureThreshold: number;
    /** How long it stays open before one trial call is allowed through. */
    resetMs: number;
};

export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * One breaker per upstream origin.
 *
 * Closed: calls pass. After `failureThreshold` consecutive failures it opens and refuses
 * calls for `resetMs`, so a struggling dependency isn't hammered by retries and this service
 * fails fast instead of tying up workers. It then lets a single trial call through
 * (half-open): success closes it, failure opens it again.
 */
export class CircuitBreaker {
    private state: CircuitState = 'closed';
    private failures = 0;
    private openedAt = 0;
    private trialInFlight = false;

    constructor(
        private readonly options: CircuitBreakerOptions,
        private readonly now: () => number = Date.now,
    ) {}

    /** `undefined` when the call may proceed, or how long until the next attempt is allowed. */
    blockedForMs(): number | undefined {
        if (this.state === 'closed') return undefined;

        const elapsed = this.now() - this.openedAt;
        if (this.state === 'open' && elapsed >= this.options.resetMs) {
            this.state = 'half-open';
            this.trialInFlight = false;
        }

        if (this.state === 'half-open') {
            if (this.trialInFlight) return this.options.resetMs;
            this.trialInFlight = true;
            return undefined;
        }

        return Math.max(0, this.options.resetMs - elapsed);
    }

    recordSuccess(): void {
        this.state = 'closed';
        this.failures = 0;
        this.trialInFlight = false;
    }

    recordFailure(): void {
        this.trialInFlight = false;

        if (this.state === 'half-open') {
            this.open();
            return;
        }

        this.failures += 1;
        if (this.failures >= this.options.failureThreshold) this.open();
    }

    current(): CircuitState {
        return this.state;
    }

    private open(): void {
        this.state = 'open';
        this.openedAt = this.now();
        this.failures = 0;
    }
}
