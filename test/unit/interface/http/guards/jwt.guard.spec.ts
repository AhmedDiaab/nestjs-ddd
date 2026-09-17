import { IS_PUBLIC } from '@interface/http/decorators';
import { JwtGuard } from '@interface/http/guards';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

const contextFor = (handler: () => void, controller: object) =>
    ({
        getHandler: () => handler,
        getClass: () => controller,
    }) as unknown as ExecutionContext;

describe('JwtGuard', () => {
    const handler = () => undefined;
    class ProbeController {}

    const superCanActivate = jest.spyOn(AuthGuard('jwt').prototype as JwtGuard, 'canActivate');

    afterEach(() => jest.clearAllMocks());

    it('lets a route through untouched when it is marked public', () => {
        // Arrange
        const reflector = { getAllAndOverride: jest.fn().mockReturnValue(true) };
        const sut = new JwtGuard(reflector as unknown as Reflector);

        // Act
        const allowed = sut.canActivate(contextFor(handler, ProbeController));

        // Assert
        expect(allowed).toBe(true);
        expect(superCanActivate).not.toHaveBeenCalled();
        expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC, [
            handler,
            ProbeController,
        ]);
    });

    it('verifies the token when nothing marks the route public', () => {
        // Arrange
        superCanActivate.mockReturnValue(true);
        const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
        const sut = new JwtGuard(reflector as unknown as Reflector);

        // Act
        const allowed = sut.canActivate(contextFor(handler, ProbeController));

        // Assert: a route that says nothing is protected, not open
        expect(allowed).toBe(true);
        expect(superCanActivate).toHaveBeenCalledTimes(1);
    });
});
