import { Deprecated } from '@interface/http/decorators/deprecated.decorator';
import { DeprecationInterceptor } from '@interface/http/interceptors/deprecation.interceptor';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';

class DemoController {
    @Deprecated({
        since: '2026-01-01',
        sunset: '2026-12-31',
        successor: 'https://api.example.com/v2/orders',
        link: 'https://docs.example.com/deprecations/orders-v1',
    })
    withLink(this: void) {
        return undefined;
    }

    @Deprecated({ since: '2026-01-01', sunset: '2026-12-31' })
    withoutLink(this: void) {
        return undefined;
    }

    current(this: void) {
        return undefined;
    }
}

describe('DeprecationInterceptor', () => {
    const reflector = new Reflector();
    const sut = new DeprecationInterceptor(reflector);

    const contextFor = (handler: () => unknown, res: Record<string, jest.Mock>): ExecutionContext =>
        ({
            switchToHttp: () => ({ getResponse: () => res }),
            getHandler: () => handler,
            getClass: () => DemoController,
        }) as unknown as ExecutionContext;

    const responseStub = () => ({ setHeader: jest.fn() });

    it('sets Deprecation and Sunset for a decorated route', async () => {
        // Arrange
        const res = responseStub();
        const context = contextFor(DemoController.prototype.withoutLink, res);
        const next: CallHandler = { handle: () => of('ok') };

        // Act
        await lastValueFrom(sut.intercept(context, next));

        // Assert
        expect(res.setHeader).toHaveBeenCalledWith(
            'Deprecation',
            `@${Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000)}`,
        );
        expect(res.setHeader).toHaveBeenCalledWith(
            'Sunset',
            new Date('2026-12-31T00:00:00Z').toUTCString(),
        );
    });

    it('sets Link when the route carries a successor or a documentation link', async () => {
        // Arrange
        const res = responseStub();
        const context = contextFor(DemoController.prototype.withLink, res);
        const next: CallHandler = { handle: () => of('ok') };

        // Act
        await lastValueFrom(sut.intercept(context, next));

        // Assert
        expect(res.setHeader).toHaveBeenCalledWith(
            'Link',
            '<https://api.example.com/v2/orders>; rel="successor-version", ' +
                '<https://docs.example.com/deprecations/orders-v1>; rel="deprecation"',
        );
    });

    it('does not set Link when the route carries neither a successor nor a link', async () => {
        // Arrange
        const res = responseStub();
        const context = contextFor(DemoController.prototype.withoutLink, res);
        const next: CallHandler = { handle: () => of('ok') };

        // Act
        await lastValueFrom(sut.intercept(context, next));

        // Assert
        expect(res.setHeader).not.toHaveBeenCalledWith('Link', expect.anything());
    });

    it('sets nothing at all for an undecorated route', async () => {
        // Arrange
        const res = responseStub();
        const context = contextFor(DemoController.prototype.current, res);
        const next: CallHandler = { handle: () => of('ok') };

        // Act
        await lastValueFrom(sut.intercept(context, next));

        // Assert
        expect(res.setHeader).not.toHaveBeenCalled();
    });

    it('always passes the handler value through untouched', async () => {
        // Arrange
        const res = responseStub();
        const context = contextFor(DemoController.prototype.withoutLink, res);
        const next: CallHandler = { handle: () => of({ id: 'order-1' }) };

        // Act
        const result = await lastValueFrom(sut.intercept(context, next));

        // Assert
        expect(result).toEqual({ id: 'order-1' });
    });
});
