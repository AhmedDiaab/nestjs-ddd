import type { LoggerPort, MetricsPort } from '@application/ports';
import { Metrics } from '@shared/metrics';
import type { ScheduledJob } from './scheduled-job';

/**
 * Runs a job safely: never lets an error reach the scheduler (which would crash the process),
 * skips a run while the previous one is still going, and logs start, duration and failures.
 */
export class JobRunner {
    /** The in-flight run, so shutdown can wait for it. `undefined` means idle. */
    private current: Promise<void> | undefined;

    constructor(
        private readonly job: ScheduledJob,
        private readonly logger: LoggerPort,
        private readonly metrics: MetricsPort,
    ) {}

    async run(): Promise<void> {
        if (this.current) {
            this.logger.warn('scheduler.job.skipped', {
                job: this.job.name,
                reason: 'still running',
            });
            this.metrics.increment(Metrics.jobRuns, { job: this.job.name, outcome: 'skipped' });
            return;
        }

        this.current = this.execute(Date.now()).finally(() => {
            this.current = undefined;
        });
        await this.current;
    }

    /** Whether a run is in flight — shutdown uses this to name a job still draining. */
    get isRunning(): boolean {
        return this.current !== undefined;
    }

    /**
     * Resolves immediately when idle, otherwise waits for the run in progress. Never rejects:
     * `execute` already swallows job failures, so the stored promise never does either.
     */
    async whenIdle(): Promise<void> {
        await this.current;
    }

    private async execute(started: number): Promise<void> {
        try {
            await this.job.run();
            this.logger.info('scheduler.job.finished', {
                job: this.job.name,
                durationMs: Date.now() - started,
            });
            this.record('succeeded', started);
        } catch (error) {
            this.logger.error('scheduler.job.failed', {
                job: this.job.name,
                durationMs: Date.now() - started,
                error,
            });
            this.record('failed', started);
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
