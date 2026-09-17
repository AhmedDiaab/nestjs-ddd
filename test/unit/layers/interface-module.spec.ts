import 'reflect-metadata';
import { ApplicationModule } from '@application';
import { InterfaceModule } from '@interface';
import { GlobalExceptionFilter } from '@interface/http';
import { FallbackController } from '@interface/http/common/fallback/fallback.controller';
import { ResponseFormatterInterceptor } from '@interface/http/common/interceptors/response-formatter.interceptor';
import { DatabaseInfoController, HealthController } from '@interface/http/controllers';
import { ZodHttpInterceptor } from '@interface/http/interceptors/zod-http.interceptor';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

jest.mock('dotenv-flow/config', () => undefined);

describe('InterfaceModule composition', () => {
    const controllers = (Reflect.getMetadata('controllers', InterfaceModule) as object[]) ?? [];
    const providers = (Reflect.getMetadata('providers', InterfaceModule) as object[]) ?? [];

    it('exposes the expected controllers with the fallback last', () => {
        expect(controllers).toEqual([HealthController, DatabaseInfoController, FallbackController]);
    });

    it('wires HTTP interceptors globally', () => {
        const interceptorProviders = providers.filter(
            (provider) => (provider as { provide?: unknown }).provide === APP_INTERCEPTOR,
        );

        expect(interceptorProviders).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ useClass: ZodHttpInterceptor }),
                expect.objectContaining({ useClass: ResponseFormatterInterceptor }),
            ]),
        );
    });

    it('registers the global exception filter', () => {
        const filterProvider = providers.find(
            (provider) => (provider as { provide?: unknown }).provide === APP_FILTER,
        );
        expect(filterProvider).toMatchObject({ useClass: GlobalExceptionFilter });
    });

    it('does not import infrastructure (wired in AppModule)', () => {
        const imports = (Reflect.getMetadata('imports', InterfaceModule) as object[]) ?? [];
        expect(imports).toContain(ApplicationModule);
        expect(imports.map((m) => (m as { name?: string }).name)).not.toContain(
            'InfrastructureModule',
        );
    });
});
