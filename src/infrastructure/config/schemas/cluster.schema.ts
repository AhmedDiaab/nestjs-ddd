import { z } from 'zod';

/**
 * Multi-core scaling on a single box via Node's built-in `cluster` module — no external process
 * manager. Off by default: the documented default stays one process per container/service.
 */
export const clusterSchema = z.object({
    /** Run a primary + N worker processes instead of one. */
    enabled: z.boolean().default(false),
    /** Worker process count; 0 = one per CPU core (`resolveWorkerCount`). */
    workers: z.coerce.number().int().min(0).default(0),
    /** Fork a replacement when a worker exits unexpectedly. */
    respawn: z.boolean().default(true),
    /** Ceiling on respawns per rolling minute, so a crash loop can't fork forever. */
    respawnMaxPerMinute: z.coerce.number().int().min(1).default(10),
    /** Port the primary serves aggregated Prometheus metrics on; unset = no aggregated endpoint. */
    metricsPort: z.coerce.number().int().min(1).max(65535).optional(),
    /**
     * Internal only — never set this by hand. The primary sets `CLUSTER_LEADER=true` on exactly
     * one worker's environment at fork time (and again on its replacement, if that worker is
     * respawned), so `JobScheduler` knows which worker owns the cron jobs. Not documented in
     * `.env.example`: operators never choose this, the primary does.
     */
    isLeader: z.boolean().default(false),
});

export type ClusterConfig = z.infer<typeof clusterSchema>;
