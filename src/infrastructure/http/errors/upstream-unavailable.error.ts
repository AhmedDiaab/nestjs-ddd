import { InfrastructureError } from '@application/errors';

/** The upstream could not be reached: DNS, connection refused, TLS, socket closed. */
export class UpstreamUnavailableError extends InfrastructureError {
    constructor(tag: string, cause?: unknown) {
        super('Upstream is unavailable', { tag, cause });
    }
}
