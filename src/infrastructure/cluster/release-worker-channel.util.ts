/** The parts of `process` this needs; keeps it testable without forking anything. */
export type DisconnectableProcess = {
    connected?: boolean;
    disconnect?: () => void;
};

/**
 * Closes a worker's IPC channel to the primary once its graceful shutdown has finished.
 *
 * A cluster worker's channel is an active handle: it keeps the event loop alive after
 * `app.close()` has already returned, so the process sits there until the primary's bounded
 * wait expires and force-kills it — every shutdown would take the full
 * `drainDelayMs + forceAfterMs + jobDrainMs` budget and log `cluster.drain.timeout`, making a
 * clean restart indistinguishable from a stuck one. Disconnecting lets the worker exit on its
 * own the moment it has nothing left to do.
 *
 * No-op outside a cluster, where `process.connected` is undefined — the single-process path is
 * unchanged.
 */
export function releaseWorkerChannel(target: DisconnectableProcess = process): void {
    if (target.connected && typeof target.disconnect === 'function') target.disconnect();
}
