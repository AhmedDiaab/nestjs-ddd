import { ForbiddenError } from '@application/errors';
import { ROLES } from '@interface/http/decorators';
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getAuthenticatedUser } from './current-user.util';

/**
 * Role check for roles carried by the token, so it costs no database round trip.
 *
 * Registered globally next to `JwtGuard`: a route without `@Roles()` is unaffected,
 * and a route that names roles can't silently lose the check by missing `@UseGuards`.
 * Authorization that needs the database, or that depends on the resource, belongs in a
 * query-port-backed guard or in the use case (docs/guides/add-an-auth-strategy.md).
 */
@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        const required = this.reflector.getAllAndOverride<string[]>(ROLES, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!required?.length) return true;

        const user = getAuthenticatedUser(context); // 401 when no strategy ran
        const held = user.roles ?? [];

        if (!required.some((role) => held.includes(role))) {
            throw new ForbiddenError('Insufficient privileges');
        }

        return true;
    }
}
