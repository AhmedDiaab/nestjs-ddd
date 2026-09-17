import { z } from 'zod';

export const httpSchema = z.object({
    port: z.coerce.number().min(1).max(65535).default(3000),
    /** Allowed origins. Empty = CORS disabled (no cross-origin browser access). */
    corsOrigins: z.array(z.string().min(1)).default([]),
    serverTimeout: z.coerce.number().min(2000).default(120000), // ms
    headersTimeout: z.coerce.number().min(2000).default(121000), // ms
    keepAliveTimeout: z.coerce.number().min(1000).default(61000), // ms
    jsonBodyLimit: z.string().default('1mb'), // e.g., 100kb, 1mb
    urlencodedBodyLimit: z.string().default('1mb'), // e.g., 100kb, 1mb
    swaggerEnabled: z.boolean().optional(), // default: off in production
    throttleTtlMs: z.coerce.number().int().min(1).default(60000),
    throttleLimit: z.coerce.number().int().min(0).default(100), // 0 disables
    trustProxy: z.boolean().default(false),
    /** Reject cross-site state-changing requests authenticated by the JWT cookie. */
    csrfEnabled: z.boolean().default(true),
    /** Origins allowed to send cookie-authenticated writes, besides the API's own. Default: corsOrigins. */
    csrfTrustedOrigins: z.array(z.string().min(1)).optional(),
});

export type HttpConfig = z.infer<typeof httpSchema>;
