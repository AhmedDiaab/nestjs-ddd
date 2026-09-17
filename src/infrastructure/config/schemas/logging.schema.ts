import { z } from 'zod';

export const loggingSchema = z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    showStackTraces: z.boolean().default(false),
    requestIdHeader: z.string().default('x-request-id'),
    toFile: z.boolean().default(true),
    directory: z.string().default('logs'),
    fileName: z.string().default('app.log'),
    filesLimit: z.coerce.number().int().min(1).max(365).default(14),
    maxSize: z
        .string()
        .regex(/^\d+(\.\d+)?[bkmg]?$/i)
        .default('10m'), // pino-roll size, e.g. 10m, 1g
    pretty: z.boolean().optional(), // default: on in development only
});

export type LoggingConfig = z.infer<typeof loggingSchema>;
