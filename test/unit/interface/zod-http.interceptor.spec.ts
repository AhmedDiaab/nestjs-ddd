import { UseZodHttp } from '@interface/http/decorators/zod-http.decorator';
import { ZodHttpInterceptor } from '@interface/http/interceptors/zod-http.interceptor';
import { BadRequestException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, Observable, of } from 'rxjs';
import { z } from 'zod';

class DemoController {
    @UseZodHttp({
        query: z.object({ workgroupId: z.string().min(1) }),
    })
    handler() {
        return undefined;
    }
}

describe('ZodHttpInterceptor', () => {
    const interceptor = new ZodHttpInterceptor(new Reflector());

    const createContext = (req: Record<string, any>): ExecutionContext => {
        return {
            switchToHttp: () => ({
                getRequest: () => req,
            }),
            // eslint-disable-next-line @typescript-eslint/unbound-method
            getHandler: () => DemoController.prototype.handler,
            getClass: () => DemoController,
        } as unknown as ExecutionContext;
    };

    it('validates request parts and stores them on req.validated', async () => {
        const req = {
            query: { workgroupId: 'ops' },
            params: {},
            body: {},
        };
        const context = createContext(req);
        const next: CallHandler = { handle: () => of('ok') };

        const stream: Observable<unknown> = await interceptor.intercept(context, next);
        const result = await lastValueFrom(stream);

        expect(result).toBe('ok');
        expect(req).toMatchObject({ validated: { query: { workgroupId: 'ops' } } });
    });

    it('throws BadRequestException with formatted details when validation fails', async () => {
        expect.assertions(3);
        const req = {
            query: {},
            params: {},
            body: {},
        };
        const context = createContext(req);
        const next: CallHandler = { handle: () => of('ok') };

        await interceptor.intercept(context, next).catch((error: unknown) => {
            expect(error).toBeInstanceOf(BadRequestException);
            const badRequest = error as BadRequestException;
            const response = badRequest.getResponse() as { message: string; details: string[] };
            expect(response.message).toBe('Validation failed');
            expect(response.details[0]).toContain('query.workgroupId');
        });
    });

    it('does not assign req.query (read-only getter in Express 5)', async () => {
        const req = Object.defineProperty({ params: {}, body: {} }, 'query', {
            get: () => ({ workgroupId: 'ops' }),
            enumerable: true,
        });
        const next: CallHandler = { handle: () => of('ok') };

        const stream: Observable<unknown> = await interceptor.intercept(createContext(req), next);

        await expect(lastValueFrom(stream)).resolves.toBe('ok');
    });
});
