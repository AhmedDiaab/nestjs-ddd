import type { ConfigPort, LoggerPort } from '@application/ports';
import { JobScheduler, type ScheduledJob } from '@interface/scheduler';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { CronJob } from 'cron';

const job = (name: string, run = jest.fn(() => Promise.resolve())): ScheduledJob => ({
    name,
    cronTime: '0 2 * * *',
    run,
});

describe('JobScheduler', () => {
    const info = jest.fn();
    const logger: LoggerPort = { debug: jest.fn(), info, warn: jest.fn(), error: jest.fn() };
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
        const sut = new JobScheduler([job('tickets.closeStale')], config, logger, registry);

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
        const sut = new JobScheduler([job('a.job'), job('b.job')], config, logger, registry);

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
        new JobScheduler([failing], config, logger, registry).onApplicationBootstrap();

        // Act
        await added.get('failing.job')?.fireOnTick();

        // Assert
        expect(run).toHaveBeenCalledTimes(1);
    });
});
