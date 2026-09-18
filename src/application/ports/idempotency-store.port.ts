import { createToken } from '@shared';

export type ClaimOutcome =
    | { outcome: 'claimed' }
    | { outcome: 'in_progress' }
    | { outcome: 'mismatch' }
    | { outcome: 'replay'; status: number; body: unknown };

/**
 * Backs `@Idempotent()`: a handler decorated with it executes at most once per key.
 *
 * TTLs are the adapter's own policy, config-driven, not the caller's — the interceptor only
 * asks "claim / complete / release", it never carries expiry semantics itself.
 */
export interface IdempotencyStorePort {
    /** Attempt to own `key` for a request fingerprinted by `fingerprint`. */
    claim(key: string, fingerprint: string): Promise<ClaimOutcome>;
    /** Record the handler's outcome so a later replay of the same key can return it. */
    complete(key: string, status: number, body: unknown): Promise<void>;
    /** Give up `key` (the handler failed), so a retry can re-claim it. */
    release(key: string): Promise<void>;
}

export const IdempotencyStorePortToken = createToken<IdempotencyStorePort>('IdempotencyStorePort');
