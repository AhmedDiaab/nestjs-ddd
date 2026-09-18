import type { LoggerPort, ShutdownPort } from '@application/ports';
import { delay as sleep } from '@common/utils';

/** The parts of `http.Server` shutdown needs; keeps this testable without a socket. */
export type ClosableServer = {
    close(callback?: (error?: Error) => void): unknown;
    closeIdleConnections?: () => void;
    closeAllConnections?: () => void;
};

export type GracefulShutdownOptions = {
    signal: string;
    server: ClosableServer;
    shutdown: ShutdownPort;
    logger: LoggerPort;
    /** Time between failing readiness and closing the server, for the load balancer to react. */
    drainDelayMs: number;
    /** After this, connections still open are cut instead of holding the process forever. */
    forceAfterMs: number;
    /** Nest's `app.close()`: destroy hooks, database pools. */
    closeApp: () => Promise<void>;
    delay?: (ms: number) => Promise<void>;
};

/**
 * Shutdown in the order a load balancer expects:
 *
 * 1. fail readiness, so no new requests are routed here;
 * 2. keep serving for `drainDelayMs` — the monitor needs a poll or two to notice;
 * 3. stop accepting connections and let in-flight requests finish;
 * 4. cut whatever is still open after `forceAfterMs`;
 * 5. close the application (database pools) once nothing is being served.
 *
 * Closing pools first — which is what happens when Nest's own signal handling runs alone —
 * fails the requests that are still in flight.
 */
export async function runGracefulShutdown({
    signal,
    server,
    shutdown,
    logger,
    drainDelayMs,
    forceAfterMs,
    closeApp,
    delay = sleep,
}: GracefulShutdownOptions): Promise<boolean> {
    if (!shutdown.begin()) {
        logger.debug('shutdown.signal.ignored', { signal });
        return false;
    }

    logger.info('shutdown.started', { signal, drainDelayMs });
    await delay(drainDelayMs);

    logger.info('shutdown.draining', { forceAfterMs });
    const forceTimer = setTimeout(() => {
        logger.warn('shutdown.forced', { forceAfterMs });
        server.closeAllConnections?.();
    }, forceAfterMs);
    forceTimer.unref();

    // keep-alive sockets with no request on them would otherwise hold the server open
    server.closeIdleConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    clearTimeout(forceTimer);

    await closeApp();
    logger.info('shutdown.finished', { signal });
    return true;
}
