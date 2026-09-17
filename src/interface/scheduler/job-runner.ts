import type { LoggerPort } from '@application/ports';
import type { ScheduledJob } from './scheduled-job';

/**
 * Runs a job safely: never lets an error reach the scheduler (which would crash the process),
 * skips a run while the previous one is still going, and logs start, duration and failures.
 */
export class JobRunner {
    private running = false;

    constructor(
        private readonly job: ScheduledJob,
        private readonly logger: LoggerPort,
    ) {}

    async run(): Promise<void> {
        if (this.running) {
            this.logger.warn('scheduler.job.skipped', {
                job: this.job.name,
                reason: 'still running',
            });
            return;
        }

        this.running = true;
        const started = Date.now();
        try {
            await this.job.run();
            this.logger.info('scheduler.job.finished', {
                job: this.job.name,
                durationMs: Date.now() - started,
            });
        } catch (err) {
            this.logger.error('scheduler.job.failed', {
                job: this.job.name,
                durationMs: Date.now() - started,
                err,
            });
        } finally {
            this.running = false;
        }
    }
}
