import { z } from 'zod';

/** How the process behaves between SIGTERM and exit. */
export const shutdownSchema = z.object({
    /**
     * Time readiness keeps failing before the server stops accepting connections.
     * Set it above the load balancer's health-check interval × threshold, or it will still
     * be routing requests here when the port closes.
     */
    drainDelayMs: z.coerce.number().int().min(0).default(5000),
    /** In-flight requests get this long before their connections are cut. */
    forceAfterMs: z.coerce.number().int().positive().default(10000),
    /**
     * Time an in-flight cron job gets to finish before the database pools close. Its own
     * variable rather than reusing `forceAfterMs`: that one *cuts* live sockets, so it wants to
     * be small; this one *waits* for a batch job to finish, so it wants to be as long as the
     * job needs. Sharing one number would make a slow nightly job also hold dead connections
     * open for `forceAfterMs` extra seconds.
     */
    jobDrainMs: z.coerce.number().int().min(0).default(10000),
});

export type ShutdownConfig = z.infer<typeof shutdownSchema>;
