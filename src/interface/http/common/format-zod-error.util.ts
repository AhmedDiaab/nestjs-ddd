import type { ZodError } from 'zod';

/** 400 body for Zod failures: `details` lists `part.path: message`, never input values. */
export function formatZodError(error: ZodError, part?: string) {
    const details = error.issues.map((i) => {
        const path = [part, ...i.path.map(String)].filter(Boolean).join('.');
        return path ? `${path}: ${i.message}` : i.message;
    });
    return { message: 'Validation failed', details };
}
