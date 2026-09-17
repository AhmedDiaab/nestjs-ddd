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
        const user = { username: 'TEST', email: 'test@example.com' } as JWTPayload;

        expect(getAuthenticatedUser(contextWith({ user }))).toBe(user);
    });

    it.each([
        ['no request at all', undefined],
        ['no user', {}],
        ['an empty user', { user: {} }],
        ['a user without a username', { user: { email: 'test@example.com' } }],
    ])('should throw UnauthorizedError for a request with %s', (_case, request) => {
        expect(() => getAuthenticatedUser(contextWith(request))).toThrow(UnauthorizedError);
    });

    it('should present as a 401 problem', () => {
        try {
            getAuthenticatedUser(contextWith({}));
            fail('expected UnauthorizedError');
        } catch (error) {
            expect((error as UnauthorizedError).toProblem()).toMatchObject({
                kind: 'unauthorized',
                title: 'Unauthorized',
            });
        }
    });
});
