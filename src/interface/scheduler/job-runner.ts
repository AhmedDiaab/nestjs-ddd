import type { LoggerPort, MetricsPort } from '@application/ports';
import { Metrics } from '@infrastructure/metrics';
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
        private readonly metrics: MetricsPort,
    ) {}

    async run(): Promise<void> {
        if (this.running) {
            this.logger.warn('scheduler.job.skipped', {
                job: this.job.name,
                reason: 'still running',
            });
            this.metrics.increment(Metrics.jobRuns, { job: this.job.name, outcome: 'skipped' });
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
            this.record('succeeded', started);
        } catch (err) {
            this.logger.error('scheduler.job.failed', {
                job: this.job.name,
                durationMs: Date.now() - started,
                err,
            });
            this.record('failed', started);
        } finally {
            this.running = false;
        }
    }

    /** A job that silently stops running is the failure nobody notices; alert on these. */
    private record(outcome: 'succeeded' | 'failed', started: number): void {
        this.metrics.increment(Metrics.jobRuns, { job: this.job.name, outcome });
        this.metrics.observe(Metrics.jobDuration, (Date.now() - started) / 1000, {
            job: this.job.name,
        });
    }
}
