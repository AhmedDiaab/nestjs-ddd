import { z } from 'zod';

export const httpSchema = z.object({
    port: z.coerce.number().min(1).max(65535).default(3000),
    corsOrigin: z.string().optional(), // comma-separated
    serverTimeout: z.coerce.number().min(2000).default(120000), // ms
    headersTimeout: z.coerce.number().min(2000).default(121000), // ms
    keepAliveTimeout: z.coerce.number().min(1000).default(61000), // ms
    jsonBodyLimit: z.string().default('1mb'), // e.g., 100kb, 1mb
    urlencodedBodyLimit: z.string().default('1mb'), // e.g., 100kb, 1mb
});

export type HttpConfig = z.infer<typeof httpSchema>;
