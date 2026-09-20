import { z } from 'zod';

/**
 * Forwards paths not yet migrated off a legacy service (option B, "New service in front" —
 * `docs/guides/migrate-a-legacy-service.md`). Off by default. Only `forwardPrefixes` are
 * forwarded; everything else still answers through this app, and `FallbackController` keeps
 * returning 404 for genuinely unknown paths.
 */
export const legacySchema = z
    .object({
        /** Forward configured prefixes to the legacy service instead of leaving them unhandled. */
        forwardEnabled: z.boolean().default(false),
        /** Base URL of the legacy service, e.g. `http://legacy-host:8080`. */
        targetUrl: z.string().min(1).optional(),
        /** Path prefixes forwarded as-is; the app still answers everything else itself. */
        forwardPrefixes: z.array(z.string().min(1)).default([]),
        /**
         * Per-request timeout to the legacy service. Kept below a typical VIP's request timeout
         * (often 30-60s), so a hung legacy call fails fast with a 504 instead of the VIP timing
         * out the whole hop first.
         */
        timeoutMs: z.coerce.number().int().positive().default(10_000),
        /** Forward the client's original Host header instead of the legacy target's. */
        preserveHostHeader: z.boolean().default(false),
    })
    .superRefine((legacy, ctx) => {
        if (!legacy.forwardEnabled) return;
        if (!legacy.targetUrl) {
            ctx.addIssue({
                code: 'custom',
                path: ['targetUrl'],
                message: 'LEGACY_TARGET_URL is required when LEGACY_FORWARD_ENABLED=true',
            });
        }
        if (legacy.forwardPrefixes.length === 0) {
            ctx.addIssue({
                code: 'custom',
                path: ['forwardPrefixes'],
                message:
                    'LEGACY_FORWARD_PREFIXES must list at least one prefix when LEGACY_FORWARD_ENABLED=true',
            });
        }
    });

export type LegacyConfig = z.infer<typeof legacySchema>;
