import { z } from 'zod';

export const idempotencySchema = z.object({
    /** memory: per instance, single-process only. oracle: shared, survives a restart. */
    store: z.enum(['memory', 'oracle']).default('memory'),
    /** Oracle only. The one identifier that can't be bound; validated by the adapter itself. */
    table: z.string().min(1).default('IDEMPOTENCY_KEYS'),
    /** How long a claimed key (in-progress or completed) is remembered at all. */
    ttlMs: z.coerce.number().int().min(1).default(86_400_000), // 24h
    /** How long an in-progress claim is honoured before it's treated as abandoned. */
    inProgressTtlMs: z.coerce.number().int().min(1).default(60_000),
    /** Header carrying the client-supplied idempotency key. */
    header: z.string().min(1).default('idempotency-key'),
});

export type IdempotencyConfig = z.infer<typeof idempotencySchema>;
