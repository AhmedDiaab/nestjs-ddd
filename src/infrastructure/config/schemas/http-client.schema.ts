import { APP_NAME } from '@shared';
import { z } from 'zod';

/** Defaults for outbound calls; a single call may override the timeout and retries. */
export const httpClientSchema = z.object({
    timeoutMs: z.coerce.number().int().positive().default(5000),
    /** Attempts after the first one, and only for calls that are safe to repeat. */
    retries: z.coerce.number().int().min(0).max(10).default(2),
    retryBaseMs: z.coerce.number().int().positive().default(200),
    retryJitterMs: z.coerce.number().int().min(0).default(150),
    retryMaxDelayMs: z.coerce.number().int().positive().default(5000),
    circuitEnabled: z.boolean().default(true),
    circuitFailureThreshold: z.coerce.number().int().positive().default(5),
    circuitResetMs: z.coerce.number().int().positive().default(30000),
    // identifies this service to the upstream; `pnpm rename-project` renames APP_NAME
    userAgent: z.string().min(1).default(APP_NAME),
});

export type HttpClientConfig = z.infer<typeof httpClientSchema>;
