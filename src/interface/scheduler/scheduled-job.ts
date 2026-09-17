import { createToken } from '@shared';

/**
 * One scheduled job: a delivery mechanism like a controller, so it only calls a use case.
 * Keep runs idempotent: a job may run again after a restart or on another instance.
 */
export interface ScheduledJob {
    /** Unique, dotted, used in logs and in SchedulerRegistry (`tickets.closeStale`). */
    readonly name: string;
    /** Cron expression, 5 or 6 fields (`0 2 * * *` = 02:00 every day, in the configured timezone). */
    readonly cronTime: string;
    run(): Promise<void>;
}

/** All jobs of the service, collected in SchedulerModule. */
export const ScheduledJobsToken = createToken<readonly ScheduledJob[]>('ScheduledJobs');
