import {
    ConfigPortToken,
    LoggerPortToken,
    type ConfigPort,
    type LoggerPort,
} from '@application/ports';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { JobRunner } from './job-runner';
import { ScheduledJobsToken, type ScheduledJob } from './scheduled-job';

/**
 * Starts the service's jobs when `SCHEDULER_ENABLED` is on. Every instance that has it on runs
 * every job, so enable it on exactly one instance (a worker) unless the job is safe to run twice.
 */
@Injectable()
export class JobScheduler implements OnApplicationBootstrap {
    constructor(
        @Inject(ScheduledJobsToken) private readonly jobs: readonly ScheduledJob[],
        @Inject(ConfigPortToken) private readonly config: ConfigPort,
        @Inject(LoggerPortToken) private readonly logger: LoggerPort,
        private readonly registry: SchedulerRegistry,
    ) {}

    onApplicationBootstrap(): void {
        if (!this.config.get('scheduler.enabled')) {
            this.logger.info('scheduler.disabled', { jobs: this.jobs.length });
            return;
        }

        const timeZone = this.config.get('scheduler.timezone');
        for (const job of this.jobs) {
            const runner = new JobRunner(job, this.logger);
            const cronJob = new CronJob(
                job.cronTime,
                () => void runner.run(),
                null,
                false,
                timeZone,
            );
            this.registry.addCronJob(job.name, cronJob);
            cronJob.start();
            this.logger.info('scheduler.job.scheduled', {
                job: job.name,
                cronTime: job.cronTime,
                timeZone,
                nextRun: cronJob.nextDate().toISO(),
            });
        }
    }
}
