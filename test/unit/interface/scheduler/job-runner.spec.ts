import type { LoggerPort, MetricsPort } from '@application/ports';
import { JobRunner } from '@interface/scheduler';

const metrics: MetricsPort = { increment: jest.fn(), observe: jest.fn(), setGauge: jest.fn() };

describe('JobRunner', () => {
    const info = jest.fn();
    const warn = jest.fn();
    const error = jest.fn();
    const logger: LoggerPort = { debug: jest.fn(), info, warn, error };

    afterEach(() => jest.clearAllMocks());

    it('runs the job and logs how long it took', async () => {
        // Arrange
        const run = jest.fn(() => Promise.resolve());
        const sut = new JobRunner(
            { name: 'tickets.closeStale', cronTime: '0 2 * * *', run },
            logger,
            metrics,
        );

        // Act
        await sut.run();

        // Assert
        expect(run).toHaveBeenCalledTimes(1);
        expect(info).toHaveBeenCalledWith(
            'scheduler.job.finished',
            expect.objectContaining({ job: 'tickets.closeStale' }),
        );
    });

    it('swallows and logs a failure so the scheduler keeps running', async () => {
        // Arrange
        const failure = new Error('database down');
        const sut = new JobRunner(
            {
                name: 'tickets.closeStale',
                cronTime: '0 2 * * *',
                run: () => Promise.reject(failure),
            },
            logger,
            metrics,
        );

        // Act
        const call = sut.run();

        // Assert
        await expect(call).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledWith(
            'scheduler.job.failed',
            expect.objectContaining({ job: 'tickets.closeStale', err: failure }),
        );
    });

    it('skips a run while the previous one is still going', async () => {
        // Arrange
        let finishFirst = () => {};
        const run = jest.fn(() => new Promise<void>((resolve) => (finishFirst = resolve)));
        const sut = new JobRunner(
            { name: 'slow.job', cronTime: '* * * * *', run },
            logger,
            metrics,
        );
        const first = sut.run();

        // Act
        await sut.run();

        // Assert
        expect(run).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            'scheduler.job.skipped',
            expect.objectContaining({ job: 'slow.job' }),
        );
        finishFirst();
        await first;
    });

    it('runs again once the previous run finished', async () => {
        // Arrange
        const run = jest.fn(() => Promise.resolve());
        const sut = new JobRunner(
            { name: 'quick.job', cronTime: '* * * * *', run },
            logger,
            metrics,
        );
        await sut.run();

        // Act
        await sut.run();

        // Assert
        expect(run).toHaveBeenCalledTimes(2);
    });

    it('resolves whenIdle immediately when nothing is running', async () => {
        // Arrange
        const sut = new JobRunner(
            { name: 'idle.job', cronTime: '* * * * *', run: jest.fn() },
            logger,
            metrics,
        );

        // Act
        const idle = sut.whenIdle();

        // Assert
        await expect(idle).resolves.toBeUndefined();
    });

    it('does not resolve whenIdle while a run is still going', async () => {
        // Arrange
        const run = jest.fn(() => new Promise<void>(() => {})); // never settles
        const sut = new JobRunner(
            { name: 'stuck.job', cronTime: '* * * * *', run },
            logger,
            metrics,
        );
        void sut.run();
        const outcome = Promise.race([
            sut.whenIdle().then(() => 'idle'),
            new Promise((resolve) => setImmediate(() => resolve('still-running'))),
        ]);

        // Act
        const result = await outcome;

        // Assert
        expect(result).toBe('still-running');
    });

    it('resolves whenIdle once the current run finishes', async () => {
        // Arrange
        let finishRun = () => {};
        const run = jest.fn(() => new Promise<void>((resolve) => (finishRun = resolve)));
        const sut = new JobRunner(
            { name: 'slow.job', cronTime: '* * * * *', run },
            logger,
            metrics,
        );
        const runPromise = sut.run();
        const idlePromise = sut.whenIdle();
        finishRun();

        // Act
        await idlePromise;

        // Assert
        await expect(runPromise).resolves.toBeUndefined();
    });

    it('does not reject whenIdle when the running job throws', async () => {
        // Arrange
        const run = jest.fn(() => Promise.reject(new Error('boom')));
        const sut = new JobRunner(
            { name: 'failing.job', cronTime: '* * * * *', run },
            logger,
            metrics,
        );
        const runPromise = sut.run();
        const idlePromise = sut.whenIdle();

        // Act
        await idlePromise;

        // Assert
        await expect(idlePromise).resolves.toBeUndefined();
        await runPromise;
    });
});
