import type { ConfigPort, LoggerPort, MetricsPort } from '@application/ports';
import { JobScheduler, type ScheduledJob } from '@interface/scheduler';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { CronJob } from 'cron';

const job = (name: string, run = jest.fn(() => Promise.resolve())): ScheduledJob => ({
    name,
    cronTime: '0 2 * * *',
    run,
});

const metrics: MetricsPort = { increment: jest.fn(), observe: jest.fn(), setGauge: jest.fn() };

describe('JobScheduler', () => {
    const info = jest.fn();
    const warn = jest.fn();
    const logger: LoggerPort = { debug: jest.fn(), info, warn, error: jest.fn() };
    const added = new Map<string, CronJob>();
    const registry = {
        addCronJob: (name: string, cronJob: CronJob) => added.set(name, cronJob),
    } as unknown as SchedulerRegistry;

    const configWith = (values: Record<string, unknown>) =>
        ({ get: (key: string) => values[key] }) as unknown as ConfigPort;

    afterEach(() => {
        added.forEach((cronJob) => void cronJob.stop());
        added.clear();
        jest.clearAllMocks();
    });

    it('schedules nothing while the scheduler is disabled', () => {
        // Arrange
        const config = configWith({ 'scheduler.enabled': false, 'scheduler.timezone': 'UTC' });
        const sut = new JobScheduler(
            [job('tickets.closeStale')],
            config,
            logger,
            metrics,
            registry,
        );

        // Act
        sut.onApplicationBootstrap();

        // Assert
        expect(added.size).toBe(0);
        expect(info).toHaveBeenCalledWith('scheduler.disabled', { jobs: 1 });
    });

    it('starts every job in the configured timezone when enabled', () => {
        // Arrange
        const config = configWith({
            'scheduler.enabled': true,
            'scheduler.timezone': 'Africa/Cairo',
        });
        const sut = new JobScheduler(
            [job('a.job'), job('b.job')],
            config,
            logger,
            metrics,
            registry,
        );

        // Act
        sut.onApplicationBootstrap();

        // Assert
        expect([...added.keys()]).toEqual(['a.job', 'b.job']);
        expect(added.get('a.job')?.isActive).toBe(true);
        expect(info).toHaveBeenCalledWith(
            'scheduler.job.scheduled',
            expect.objectContaining({ job: 'a.job', timeZone: 'Africa/Cairo' }),
        );
    });

    it('runs the job through JobRunner, so a failure never reaches the scheduler', async () => {
        // Arrange
        const run = jest.fn(() => Promise.reject(new Error('boom')));
        const failing = job('failing.job', run);
        const config = configWith({ 'scheduler.enabled': true, 'scheduler.timezone': 'UTC' });
        new JobScheduler([failing], config, logger, metrics, registry).onApplicationBootstrap();

        // Act
        await added.get('failing.job')?.fireOnTick();

        // Assert
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('returns at once without draining when the scheduler is disabled', async () => {
        // Arrange
        const config = configWith({ 'scheduler.enabled': false, 'scheduler.timezone': 'UTC' });
        const sut = new JobScheduler([job('a.job')], config, logger, metrics, registry);
        sut.onApplicationBootstrap();

        // Act
        await sut.stop(1000);

        // Assert
        expect(info).not.toHaveBeenCalledWith('scheduler.drained', expect.anything());
        expect(warn).not.toHaveBeenCalledWith('scheduler.drain.timeout', expect.anything());
    });

    it('stops every registered cron job so no new run starts', async () => {
        // Arrange
        const config = configWith({ 'scheduler.enabled': true, 'scheduler.timezone': 'UTC' });
        const sut = new JobScheduler(
            [job('a.job'), job('b.job')],
            config,
            logger,
            metrics,
            registry,
        );
        sut.onApplicationBootstrap();

        // Act
        await sut.stop(1000);

        // Assert
        expect(added.get('a.job')?.isActive).toBe(false);
        expect(added.get('b.job')?.isActive).toBe(false);
    });

    it('waits for an in-flight run before resolving, then logs the drain', async () => {
        // Arrange
        let finishJob = () => {};
        const run = jest.fn(() => new Promise<void>((resolve) => (finishJob = resolve)));
        const busy = job('busy.job', run);
        const config = configWith({ 'scheduler.enabled': true, 'scheduler.timezone': 'UTC' });
        const sut = new JobScheduler([busy], config, logger, metrics, registry);
        sut.onApplicationBootstrap();
        await added.get('busy.job')?.fireOnTick();
        finishJob();

        // Act
        await sut.stop(1000);

        // Assert
        expect(info).toHaveBeenCalledWith(
            'scheduler.drained',
            expect.objectContaining({ jobs: ['busy.job'] }),
        );
    });

    it('warns scheduler.drain.timeout naming the job and still returns when it outlasts the drain', async () => {
        // Arrange
        const run = jest.fn(() => new Promise<void>(() => {})); // never settles
        const stuck = job('stuck.job', run);
        const config = configWith({ 'scheduler.enabled': true, 'scheduler.timezone': 'UTC' });
        const sut = new JobScheduler([stuck], config, logger, metrics, registry);
        sut.onApplicationBootstrap();
        await added.get('stuck.job')?.fireOnTick();

        // Act
        await sut.stop(10);

        // Assert
        expect(warn).toHaveBeenCalledWith(
            'scheduler.drain.timeout',
            expect.objectContaining({ jobs: ['stuck.job'], timeoutMs: 10 }),
        );
    });
});
