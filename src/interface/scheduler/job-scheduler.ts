import {
    ConfigPortToken,
    LoggerPortToken,
    MetricsPortToken,
    type ConfigPort,
    type LoggerPort,
    type MetricsPort,
} from '@application/ports';
import { withTimeout } from '@common/utils';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { JobRunner } from './job-runner';
import { ScheduledJobsToken, type ScheduledJob } from './scheduled-job';

type RegisteredJob = {
    readonly name: string;
    readonly cronJob: CronJob;
    readonly runner: JobRunner;
};

/**
 * Starts the service's jobs when `SCHEDULER_ENABLED` is on. Every instance that has it on runs
 * every job, so enable it on exactly one instance (a worker) unless the job is safe to run twice.
 */
@Injectable()
export class JobScheduler implements OnApplicationBootstrap {
    private readonly registered: RegisteredJob[] = [];

    constructor(
        @Inject(ScheduledJobsToken) private readonly jobs: readonly ScheduledJob[],
        @Inject(ConfigPortToken) private readonly config: ConfigPort,
        @Inject(LoggerPortToken) private readonly logger: LoggerPort,
        @Inject(MetricsPortToken) private readonly metrics: MetricsPort,
        private readonly registry: SchedulerRegistry,
    ) {}

    onApplicationBootstrap(): void {
        if (!this.config.get('scheduler.enabled')) {
            this.logger.info('scheduler.disabled', { jobs: this.jobs.length });
            return;
        }

        const timeZone = this.config.get('scheduler.timezone');
        for (const job of this.jobs) {
            const runner = new JobRunner(job, this.logger, this.metrics);
            const cronJob = new CronJob(
                job.cronTime,
                () => void runner.run(),
                null,
                false,
                timeZone,
            );
            this.registry.addCronJob(job.name, cronJob);
            cronJob.start();
            this.registered.push({ name: job.name, cronJob, runner });
            this.logger.info('scheduler.job.scheduled', {
                job: job.name,
                cronTime: job.cronTime,
                timeZone,
                nextRun: cronJob.nextDate().toISO(),
            });
        }
    }

    /**
     * Stops every registered cron job so no new run starts, then waits up to `timeoutMs` for
     * whatever is mid-run. Returns at once when the scheduler never started (disabled, or no
     * jobs are currently running).
     */
    async stop(timeoutMs: number): Promise<void> {
        if (this.registered.length === 0) return;

        // Snapshot who is mid-run before anything here yields, so a job that finishes while
        // the cron jobs are being stopped is still waited for and still logged as drained.
        const running = this.registered.filter(({ runner }) => runner.isRunning);

        // stop() can return a promise (cron's own onComplete hook, unused here) or undefined;
        // Promise.resolve normalizes both so nothing is left floating.
        await Promise.all(this.registered.map(({ cronJob }) => Promise.resolve(cronJob.stop())));

        if (running.length === 0) return;

        const started = Date.now();
        try {
            await withTimeout(
                Promise.all(running.map(({ runner }) => runner.whenIdle())),
                timeoutMs,
            );
            this.logger.info('scheduler.drained', {
                jobs: running.map(({ name }) => name),
                durationMs: Date.now() - started,
            });
        } catch {
            this.logger.warn('scheduler.drain.timeout', {
                jobs: running.filter(({ runner }) => runner.isRunning).map(({ name }) => name),
                timeoutMs,
            });
        }
    }
}
