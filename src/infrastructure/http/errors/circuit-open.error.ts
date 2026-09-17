import { InfrastructureError } from '@application/errors';

/**
 * The breaker for this upstream is open, so the call was refused without being made.
 * Failing here keeps a struggling dependency from consuming every worker on retries.
 */
export class CircuitOpenError extends InfrastructureError {
    constructor(target: string, retryInMs: number) {
        super(`Circuit open for ${target}`, { target, retryInMs });
    }
}
