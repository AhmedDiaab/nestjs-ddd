import type { JWTPayload } from '@domain/auth';

declare module 'express' {
    export interface Request {
        user?: JWTPayload;
        cookies: Record<string, string | undefined>;
        /** Validated request parts written by ZodHttpInterceptor (Express 5 `req.query` is read-only). */
        validated?: {
            body?: unknown;
            query?: unknown;
            params?: unknown;
            headers?: unknown;
        };
    }
}
