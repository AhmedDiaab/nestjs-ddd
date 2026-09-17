import { UnauthorizedError } from '@application/errors';
import type { JWTPayload } from '@domain/auth';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Reads the authenticated user off the request.
 *
 * A guard can be reordered or applied on its own, so `JwtGuard` having populated
 * `req.user` is not a given: a missing user has to surface as a 401, never as a
 * TypeError turned 500.
 */
export function getAuthenticatedUser(context: ExecutionContext): JWTPayload {
    const request = context.switchToHttp().getRequest<Request | undefined>();

    if (!request?.user?.username) {
        throw new UnauthorizedError('Authentication required');
    }

    return request.user;
}
