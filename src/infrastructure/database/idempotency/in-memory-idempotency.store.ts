import type { ClaimOutcome, ConfigPort, IdempotencyStorePort } from '@application/ports';

type ClaimRecord = {
    fingerprint: string;
    state: 'in_progress' | 'completed';
    claimedAt: number;
    expiresAt: number;
    status?: number;
    body?: unknown;
};

/**
 * Single-instance only: state lives in this process's memory, so it does not survive a
 * restart and is not shared across replicas. Fine for a single-instance service; anything
 * behind a load balancer with more than one instance needs the Oracle adapter instead.
 */
export class InMemoryIdempotencyStore implements IdempotencyStorePort {
    private readonly records = new Map<string, ClaimRecord>();
    private readonly ttlMs: number;
    private readonly inProgressTtlMs: number;

    constructor(config: ConfigPort) {
        this.ttlMs = config.get('idempotency.ttlMs');
        this.inProgressTtlMs = config.get('idempotency.inProgressTtlMs');
    }

    claim(key: string, fingerprint: string): Promise<ClaimOutcome> {
        const now = Date.now();
        const existing = this.records.get(key);

        if (!existing || existing.expiresAt <= now) {
            this.records.set(key, {
                fingerprint,
                state: 'in_progress',
                claimedAt: now,
                expiresAt: now + this.ttlMs,
            });
            return Promise.resolve({ outcome: 'claimed' });
        }

        if (existing.fingerprint !== fingerprint) {
            return Promise.resolve({ outcome: 'mismatch' });
        }

        if (existing.state === 'in_progress') {
            if (now - existing.claimedAt > this.inProgressTtlMs) {
                this.records.set(key, {
                    fingerprint,
                    state: 'in_progress',
                    claimedAt: now,
                    expiresAt: now + this.ttlMs,
                });
                return Promise.resolve({ outcome: 'claimed' });
            }
            return Promise.resolve({ outcome: 'in_progress' });
        }

        return Promise.resolve({
            outcome: 'replay',
            status: existing.status ?? 200,
            body: existing.body,
        });
    }

    complete(key: string, status: number, body: unknown): Promise<void> {
        const existing = this.records.get(key);
        if (existing) {
            existing.state = 'completed';
            existing.status = status;
            existing.body = body;
        }
        return Promise.resolve();
    }

    release(key: string): Promise<void> {
        this.records.delete(key);
        return Promise.resolve();
    }
}
