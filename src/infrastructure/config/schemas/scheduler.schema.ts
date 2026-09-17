import { z } from 'zod';

export const schedulerSchema = z.object({
    /** Off by default: with several instances, each one would run every job. */
    enabled: z.boolean().default(false),
    /** IANA timezone the cron expressions are read in. */
    timezone: z.string().min(1).default('UTC'),
});

export type SchedulerConfig = z.infer<typeof schedulerSchema>;
