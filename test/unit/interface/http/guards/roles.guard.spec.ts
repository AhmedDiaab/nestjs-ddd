import { ForbiddenError, UnauthorizedError } from '@application/errors';
import type { JWTPayload } from '@domain/auth';
import { ROLES } from '@interface/http/decorators';
import { RolesGuard } from '@interface/http/guards';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

const handler = () => undefined;
class ProbeController {}

const contextFor = (user?: Partial<JWTPayload>) =>
    ({
        getHandler: () => handler,
        getClass: () => ProbeController,
        switchToHttp: () => ({ getRequest: () => (user ? { user } : {}) }),
    }) as unknown as ExecutionContext;

const reflectorFor = (required: string[] | undefined) =>
    ({ getAllAndOverride: () => required }) as unknown as Reflector;

describe('RolesGuard', () => {
    it('lets an authenticated caller through when the route names no role', () => {
        // Arrange
        const sut = new RolesGuard(reflectorFor(undefined));

        // Act
        const allowed = sut.canActivate(contextFor({ username: 'alice' }));

        // Assert
        expect(allowed).toBe(true);
    });

    it('allows a caller holding one of the required roles', () => {
        // Arrange
        const sut = new RolesGuard(reflectorFor(['admin', 'auditor']));

        // Act
        const allowed = sut.canActivate(contextFor({ username: 'alice', roles: ['auditor'] }));

        // Assert
        expect(allowed).toBe(true);
    });

    it('refuses a caller holding none of them with 403, not a bare false', () => {
        // Arrange
        const sut = new RolesGuard(reflectorFor(['admin']));

        // Act
        const refuse = () => sut.canActivate(contextFor({ username: 'alice', roles: ['viewer'] }));

        // Assert
        expect(refuse).toThrow(ForbiddenError);
    });

    it('refuses a token without any roles at all', () => {
        // Arrange: the issuer does not put roles in the token
        const sut = new RolesGuard(reflectorFor(['admin']));

        // Act
        const refuse = () => sut.canActivate(contextFor({ username: 'alice' }));

        // Assert
        expect(refuse).toThrow(ForbiddenError);
    });

    it('reports a missing user as 401, not 403', () => {
        // Arrange: no strategy populated req.user
        const sut = new RolesGuard(reflectorFor(['admin']));

        // Act
        const refuse = () => sut.canActivate(contextFor(undefined));

        // Assert
        expect(refuse).toThrow(UnauthorizedError);
    });

    it('reads the metadata from the handler and the controller', () => {
        // Arrange
        const getAllAndOverride = jest.fn().mockReturnValue(['admin']);
        const sut = new RolesGuard({ getAllAndOverride } as unknown as Reflector);

        // Act
        sut.canActivate(contextFor({ username: 'alice', roles: ['admin'] }));

        // Assert
        expect(getAllAndOverride).toHaveBeenCalledWith(ROLES, [handler, ProbeController]);
    });
});
