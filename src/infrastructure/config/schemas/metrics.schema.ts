import { z } from 'zod';

export const metricsSchema = z.object({
    /** Off by default: `/metrics` exists only where something scrapes it. */
    enabled: z.boolean().default(false),
    /** Node and process metrics (heap, event loop lag, GC) from prom-client. */
    defaultMetrics: z.boolean().default(true),
    path: z.string().startsWith('/').default('/metrics'),
});

export type MetricsConfig = z.infer<typeof metricsSchema>;
