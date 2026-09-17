import { BadRequestError } from '@application/errors';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { ZodType } from 'zod';

/**
 * Guards run before pipes and interceptors, so `req.params` is still raw inside a guard.
 * Validate what the guard reads here, before it reaches a use case or the database.
 */
export function readGuardInput<T>(
    context: ExecutionContext,
    part: 'params' | 'query' | 'body',
    schema: ZodType<T>,
): T {
    const req = context.switchToHttp().getRequest<Request>();
    const parsed = schema.safeParse(req[part]);
    if (!parsed.success) {
        throw new BadRequestError(`Invalid request ${part}`);
    }
    return parsed.data;
}
