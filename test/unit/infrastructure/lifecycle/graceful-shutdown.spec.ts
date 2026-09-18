import type { LoggerPort } from '@application/ports';
import { runGracefulShutdown, ShutdownState, type ClosableServer } from '@infrastructure/lifecycle';

type Recorded = string[];

const serverThatCloses = (steps: Recorded): ClosableServer => ({
    close(callback?: (error?: Error) => void) {
        steps.push('server.close');
        callback?.();
        return undefined;
    },
    closeIdleConnections: () => steps.push('closeIdleConnections'),
    closeAllConnections: () => steps.push('closeAllConnections'),
});

describe('runGracefulShutdown', () => {
    const logger: LoggerPort = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };

    afterEach(() => jest.clearAllMocks());

    it('fails readiness before it waits, so the load balancer is told first', async () => {
        // Arrange
        const steps: Recorded = [];
        const shutdown = new ShutdownState();
        const readinessDuringDelay: boolean[] = [];

        // Act
        await runGracefulShutdown({
            signal: 'SIGTERM',
            server: serverThatCloses(steps),
            shutdown,
            logger,
            drainDelayMs: 5,
            forceAfterMs: 50,
            closeApp: () => Promise.resolve(void steps.push('app.close')),
            delay: () => {
                readinessDuringDelay.push(shutdown.isShuttingDown());
                return Promise.resolve();
            },
        });

        // Assert
        expect(readinessDuringDelay).toEqual([true]);
    });

    it('closes the server before the application, so pools outlive in-flight requests', async () => {
        // Arrange
        const steps: Recorded = [];

        // Act
        await runGracefulShutdown({
            signal: 'SIGTERM',
            server: serverThatCloses(steps),
            shutdown: new ShutdownState(),
            logger,
            drainDelayMs: 0,
            forceAfterMs: 50,
            closeApp: () => Promise.resolve(void steps.push('app.close')),
            delay: () => Promise.resolve(),
        });

        // Assert
        expect(steps).toEqual(['closeIdleConnections', 'server.close', 'app.close']);
    });

    it('drains in-flight jobs after the server closes and before the pools do', async () => {
        // Arrange
        const steps: Recorded = [];

        // Act
        await runGracefulShutdown({
            signal: 'SIGTERM',
            server: serverThatCloses(steps),
            shutdown: new ShutdownState(),
            logger,
            drainDelayMs: 0,
            forceAfterMs: 50,
            closeApp: () => Promise.resolve(void steps.push('app.close')),
            drainJobs: () => Promise.resolve(void steps.push('drain.jobs')),
            delay: () => Promise.resolve(),
        });

        // Assert
        expect(steps).toEqual(['closeIdleConnections', 'server.close', 'drain.jobs', 'app.close']);
    });

    it('completes without a drainJobs option', async () => {
        // Arrange
        const steps: Recorded = [];

        // Act
        const finished = await runGracefulShutdown({
            signal: 'SIGTERM',
            server: serverThatCloses(steps),
            shutdown: new ShutdownState(),
            logger,
            drainDelayMs: 0,
            forceAfterMs: 50,
            closeApp: () => Promise.resolve(void steps.push('app.close')),
            delay: () => Promise.resolve(),
        });

        // Assert
        expect(finished).toBe(true);
        expect(steps).toEqual(['closeIdleConnections', 'server.close', 'app.close']);
    });

    it('waits the configured drain delay before closing anything', async () => {
        // Arrange
        const waited: number[] = [];

        // Act
        await runGracefulShutdown({
            signal: 'SIGTERM',
            server: serverThatCloses([]),
            shutdown: new ShutdownState(),
            logger,
            drainDelayMs: 7000,
            forceAfterMs: 50,
            closeApp: () => Promise.resolve(),
            delay: (ms) => {
                waited.push(ms);
                return Promise.resolve();
            },
        });

        // Assert
        expect(waited).toEqual([7000]);
    });

    it('cuts connections that outstay the force deadline', async () => {
        // Arrange
        jest.useFakeTimers();
        const steps: Recorded = [];
        let finishClose: (() => void) | undefined;
        const server: ClosableServer = {
            close(callback?: () => void) {
                steps.push('server.close');
                finishClose = callback;
                return undefined;
            },
            closeIdleConnections: () => steps.push('closeIdleConnections'),
            closeAllConnections: () => {
                steps.push('closeAllConnections');
                finishClose?.();
            },
        };

        // Act
        const shutdownRun = runGracefulShutdown({
            signal: 'SIGTERM',
            server,
            shutdown: new ShutdownState(),
            logger,
            drainDelayMs: 0,
            forceAfterMs: 1000,
            closeApp: () => Promise.resolve(void steps.push('app.close')),
            delay: () => Promise.resolve(),
        });
        await Promise.resolve();
        jest.advanceTimersByTime(1000);
        await shutdownRun;

        // Assert
        expect(steps).toEqual([
            'closeIdleConnections',
            'server.close',
            'closeAllConnections',
            'app.close',
        ]);
        jest.useRealTimers();
    });

    it('ignores a second signal instead of shutting down twice', async () => {
        // Arrange
        const steps: Recorded = [];
        const shutdown = new ShutdownState();
        const options = {
            signal: 'SIGTERM',
            server: serverThatCloses(steps),
            shutdown,
            logger,
            drainDelayMs: 0,
            forceAfterMs: 50,
            closeApp: () => Promise.resolve(void steps.push('app.close')),
            delay: () => Promise.resolve(),
        };
        await runGracefulShutdown(options);

        // Act
        const second = await runGracefulShutdown({ ...options, signal: 'SIGINT' });

        // Assert
        expect(second).toBe(false);
        expect(steps.filter((step) => step === 'app.close')).toHaveLength(1);
    });

    it('works with a server that has no connection helpers', async () => {
        // Arrange: an older Node http server, or a test double
        const steps: Recorded = [];
        const bare: ClosableServer = {
            close(callback?: () => void) {
                steps.push('server.close');
                callback?.();
                return undefined;
            },
        };

        // Act
        const finished = await runGracefulShutdown({
            signal: 'SIGTERM',
            server: bare,
            shutdown: new ShutdownState(),
            logger,
            drainDelayMs: 0,
            forceAfterMs: 50,
            closeApp: () => Promise.resolve(void steps.push('app.close')),
            delay: () => Promise.resolve(),
        });

        // Assert
        expect(finished).toBe(true);
        expect(steps).toEqual(['server.close', 'app.close']);
    });
});
