import { z } from 'zod';

export const jwtSchema = z.object({
    secret: z.string().min(32, { error: 'JWT_SECRET must be at least 32 characters' }),
    algorithms: z
        .array(z.enum(['HS256', 'HS384', 'HS512', 'RS256', 'RS384', 'RS512', 'ES256', 'ES384']))
        .min(1)
        .default(['HS256']),
    issuer: z.string().min(1).optional(),
    audience: z.string().min(1).optional(),
    cookieName: z.string().min(1).default('jwt'),
});

export type JWTConfig = z.infer<typeof jwtSchema>;
