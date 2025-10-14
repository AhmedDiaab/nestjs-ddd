import { z } from 'zod';

export const loggingSchema = z.object({
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    showStackTraces: z.boolean().default(false),
    requestIdHeader: z.string().default('x-request-id'),
    toFile: z.boolean().default(true),
    directory: z.string().default('logs'),
    fileName: z.string().default('app.log'),
    filesLimit: z.number().min(1).max(365).default(14),
    maxSize: z.string().default('10M'),
});

export type LoggingConfig = z.infer<typeof loggingSchema>;
