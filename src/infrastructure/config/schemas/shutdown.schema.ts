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
});

export type ShutdownConfig = z.infer<typeof shutdownSchema>;
