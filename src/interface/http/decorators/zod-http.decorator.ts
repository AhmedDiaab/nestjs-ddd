// interface/http/zod/zod-http.decorator.ts
import { SetMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';

export const ZOD_HTTP_SCHEMA = 'zod:httpSchema';

export type ZodHttpSchema = {
    body?: ZodType;
    query?: ZodType;
    params?: ZodType;
    headers?: ZodType;
    async?: boolean; // if any schema uses async refinements
};

/**
 * Attach Zod schemas to a route (method) or controller (class).
 * Method metadata overrides class metadata (per Nest standard).
 */
export const UseZodHttp = (schema: ZodHttpSchema) => SetMetadata(ZOD_HTTP_SCHEMA, schema);
