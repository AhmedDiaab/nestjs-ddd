import { z } from 'zod';

export const appSchema = z.object({
    env: z.enum(['development', 'test', 'staging', 'production']),
});

export type AppSectionConfig = z.infer<typeof appSchema>;
