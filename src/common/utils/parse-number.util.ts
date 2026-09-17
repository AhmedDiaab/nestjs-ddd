import type { Maybe } from '@shared';
import { z } from 'zod';

const numericStringSchema = z.coerce.number();

export function parseNumber(raw: unknown): Maybe<number> {
    if (typeof raw === 'string' && raw.trim() === '') return undefined;
    const result = numericStringSchema.safeParse(raw);
    return result.success ? result.data : undefined;
}
