import { Validated } from '@interface/http/decorators';
import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

type ParamFactory = (part: string, ctx: ExecutionContext) => unknown;

/** Nest stores the decorator's factory in route-args metadata; pull it out to call it directly. */
function factoryOf(decorator: typeof Validated): ParamFactory {
    class Probe {
        handler(@decorator('query') _value: unknown) {
            return _value;
        }
    }
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler') as Record<
        string,
        { factory: ParamFactory }
    >;
    return Object.values(args)[0].factory;
}

const contextWith = (request: Record<string, unknown>) =>
    ({ switchToHttp: () => ({ getRequest: () => request }) }) as unknown as ExecutionContext;

describe('@Validated', () => {
    const readPart = factoryOf(Validated);

    it('returns the validated value stored by ZodHttpInterceptor', () => {
        // Arrange
        const context = contextWith({ query: { page: '2' }, validated: { query: { page: 2 } } });

        // Act
        const query = readPart('query', context);

        // Assert
        expect(query).toEqual({ page: 2 });
    });

    it('falls back to the raw part when the route has no schema for it', () => {
        // Arrange
        const context = contextWith({ body: { raw: true }, validated: { query: { page: 2 } } });

        // Act
        const body = readPart('body', context);

        // Assert
        expect(body).toEqual({ raw: true });
    });

    it('falls back to the raw part when nothing was validated', () => {
        // Arrange
        const context = contextWith({ params: { id: '1' } });

        // Act
        const params = readPart('params', context);

        // Assert
        expect(params).toEqual({ id: '1' });
    });
});
