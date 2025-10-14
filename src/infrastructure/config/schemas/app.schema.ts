import { z } from 'zod';

export const appSchema = z.object({
    env: z.enum(['development', 'test', 'staging', 'production']),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    showStackTraces: z.boolean().default(false),
});

export type AppConfig = z.infer<typeof appSchema>;
