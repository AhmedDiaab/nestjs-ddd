import { InfrastructureError } from '@application/errors';

/** The upstream did not answer within the timeout for this call. */
export class UpstreamTimeoutError extends InfrastructureError {
    constructor(tag: string, timeoutMs: number) {
        super(`Upstream call timed out after ${timeoutMs}ms`, { tag, timeoutMs });
    }
}
