// interface/http/schemas/pagination.schema.ts
import { z } from 'zod';

export const OffsetQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    size: z.coerce.number().int().min(1).max(100).default(20),
    // e.g. "createdAt:desc"
    orderBy: z
        .string()
        .regex(/^[a-zA-Z0-9_]+:(asc|desc)$/)
        .default('createdAt:desc'),
});

export type OffsetQueryInput = z.infer<typeof OffsetQuerySchema>;

export const CursorQuerySchema = z.object({
    size: z.coerce.number().int().min(1).max(100).default(20),
    after: z.string().min(1).optional(),
    before: z.string().min(1).optional(),
    // e.g. "createdAt:desc,id:desc"
    orderBy: z
        .string()
        .regex(/^[a-zA-Z0-9_]+:(asc|desc)(,id:(asc|desc))?$/)
        .default('createdAt:desc,id:desc'),
});

export type CursorQueryInput = z.infer<typeof CursorQuerySchema>;
