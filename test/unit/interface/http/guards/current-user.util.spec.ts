import { UnauthorizedError } from '@application/errors';
import type { JWTPayload } from '@domain/auth';
import { getAuthenticatedUser } from '@interface/http/guards';
import type { ExecutionContext } from '@nestjs/common';

describe('getAuthenticatedUser test suite', () => {
    const contextWith = (request: unknown) =>
        ({
            switchToHttp: () => ({ getRequest: () => request }),
        }) as ExecutionContext;

    it('should return the user placed on the request by JwtGuard', () => {
        // Arrange
        const user = { username: 'TEST', email: 'test@example.com' } as JWTPayload;
        const context = contextWith({ user });

        // Act
        const result = getAuthenticatedUser(context);

        // Assert
        expect(result).toBe(user);
    });

    it.each([
        ['no request at all', undefined],
        ['no user', {}],
        ['an empty user', { user: {} }],
        ['a user without a username', { user: { email: 'test@example.com' } }],
    ])('should throw UnauthorizedError for a request with %s', (_case, request) => {
        // Arrange
        const context = contextWith(request);

        // Act
        const read = () => getAuthenticatedUser(context);

        // Assert
        expect(read).toThrow(UnauthorizedError);
    });

    it('should present as a 401 problem', () => {
        // Arrange
        const context = contextWith({});

        // Act
        let error: unknown;
        try {
            getAuthenticatedUser(context);
        } catch (e) {
            error = e;
        }

        // Assert
        expect(error).toBeInstanceOf(UnauthorizedError);
        expect((error as UnauthorizedError).toProblem()).toMatchObject({
            kind: 'unauthorized',
            title: 'Unauthorized',
        });
    });
});
