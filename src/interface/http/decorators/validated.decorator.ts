import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

type Part = 'body' | 'query' | 'params' | 'headers';

/**
 * Reads the Zod-validated value of a request part (set by `@UseZodHttp`).
 * Falls back to the raw part when the route has no schema for it.
 *
 * @example handler(@Validated('query') query: OffsetQueryInput)
 */
export const Validated = createParamDecorator((part: Part, ctx: ExecutionContext): unknown => {
    const req = ctx.switchToHttp().getRequest<Request>();
    return req.validated && part in req.validated ? req.validated[part] : req[part];
});
