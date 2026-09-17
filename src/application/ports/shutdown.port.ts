import { createToken } from '@shared';

/**
 * Whether the process is on its way out.
 *
 * Readiness answers from this: an instance that is draining must tell the load balancer to
 * stop sending work **before** it stops being able to do it.
 */
export interface ShutdownPort {
    isShuttingDown(): boolean;
    /** Marks the process as draining. Idempotent; returns false if it was already set. */
    begin(): boolean;
}

export const ShutdownPortToken = createToken<ShutdownPort>('ShutdownPort');
