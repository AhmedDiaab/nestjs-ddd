import type { ShutdownPort } from '@application/ports';

/** One flag per process, flipped by the signal handler and read by the readiness probe. */
export class ShutdownState implements ShutdownPort {
    private shuttingDown = false;

    isShuttingDown(): boolean {
        return this.shuttingDown;
    }

    begin(): boolean {
        if (this.shuttingDown) return false;
        this.shuttingDown = true;
        return true;
    }
}
