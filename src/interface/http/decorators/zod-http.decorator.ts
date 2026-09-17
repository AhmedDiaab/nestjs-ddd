import { SetMetadata } from '@nestjs/common';
import type { ZodType } from 'zod';
import { zodRequestDocs } from '../swagger/zod-openapi';

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
 * On methods it also documents body, query, path params and headers in Swagger from the same schemas.
 */
export const UseZodHttp =
    (schema: ZodHttpSchema) =>
    (target: object, key?: string | symbol, descriptor?: PropertyDescriptor): void => {
        if (key === undefined || descriptor === undefined) {
            SetMetadata(ZOD_HTTP_SCHEMA, schema)(target as () => void);
            return;
        }
        SetMetadata(ZOD_HTTP_SCHEMA, schema)(target, key, descriptor);
        for (const decorate of zodRequestDocs(schema)) decorate(target, key, descriptor);
    };
