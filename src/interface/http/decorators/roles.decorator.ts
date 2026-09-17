import { SetMetadata } from '@nestjs/common';

export const ROLES = 'auth:roles';

/**
 * Requires the authenticated user to hold at least one of these roles.
 *
 * Checked by the global `RolesGuard` against `JWTPayload.roles`; a route that
 * names no role is reachable by any authenticated caller.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES, roles);
