/**
 * Pure: how many workers the primary should fork. `configuredWorkers === 0` means "one per CPU
 * core"; the result is always at least 1 — a primary that would fork zero workers is a primary
 * that serves nothing.
 */
export function resolveWorkerCount(configuredWorkers: number, cpuCount: number): number {
    const requested = configuredWorkers > 0 ? configuredWorkers : cpuCount;
    return Math.max(1, Math.floor(requested));
}
