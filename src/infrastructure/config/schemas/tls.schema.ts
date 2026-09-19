import { z } from 'zod';

export const tlsSchema = z
    .object({
        /** Terminate TLS in this process instead of a load balancer/VIP. Default: off. */
        enabled: z.boolean().default(false),
        keyFile: z.string().min(1).optional(),
        certFile: z.string().min(1).optional(),
        /** Extra trust chain (e.g. a private/internal CA); optional even when enabled. */
        caFile: z.string().min(1).optional(),
        passphrase: z.string().min(1).optional(),
        minVersion: z.enum(['TLSv1.2', 'TLSv1.3']).default('TLSv1.2'),
    })
    .superRefine((tls, ctx) => {
        if (!tls.enabled) return;
        if (!tls.keyFile) {
            ctx.addIssue({
                code: 'custom',
                path: ['keyFile'],
                message: 'TLS_KEY_FILE is required when TLS_ENABLED=true',
            });
        }
        if (!tls.certFile) {
            ctx.addIssue({
                code: 'custom',
                path: ['certFile'],
                message: 'TLS_CERT_FILE is required when TLS_ENABLED=true',
            });
        }
    });

export type TlsConfig = z.infer<typeof tlsSchema>;
