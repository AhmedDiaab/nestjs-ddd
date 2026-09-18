import 'reflect-metadata';
import { ApplicationModule } from '@application';
import { InterfaceModule } from '@interface';
import { GlobalExceptionFilter } from '@interface/http';
import { FallbackController } from '@interface/http/common/fallback/fallback.controller';
import { ResponseFormatterInterceptor } from '@interface/http/common/interceptors/response-formatter.interceptor';
import {
    DatabaseInfoController,
    HealthController,
    HealthSourcesController,
    MetricsController,
} from '@interface/http/controllers';
import { ZodHttpInterceptor } from '@interface/http/interceptors/zod-http.interceptor';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

jest.mock('dotenv-flow/config', () => undefined);

const metadata = (key: string) => (Reflect.getMetadata(key, InterfaceModule) as object[]) ?? [];
const provides = (token: unknown) => (provider: object) =>
    (provider as { provide?: unknown }).provide === token;

describe('InterfaceModule composition', () => {
    it('exposes the expected controllers with the fallback last', () => {
        // Arrange
        const expected = [
            HealthController,
            HealthSourcesController,
            MetricsController,
            DatabaseInfoController,
            FallbackController,
        ];

        // Act
        const controllers = metadata('controllers');

        // Assert
        expect(controllers).toEqual(expected);
    });

    it('wires HTTP interceptors globally', () => {
        // Arrange
        const providers = metadata('providers');

        // Act
        const interceptorProviders = providers.filter(provides(APP_INTERCEPTOR));

        // Assert
        expect(interceptorProviders).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ useClass: ZodHttpInterceptor }),
                expect.objectContaining({ useClass: ResponseFormatterInterceptor }),
            ]),
        );
    });

    it('registers the global exception filter', () => {
        // Arrange
        const providers = metadata('providers');

        // Act
        const filterProvider = providers.find(provides(APP_FILTER));

        // Assert
        expect(filterProvider).toMatchObject({ useClass: GlobalExceptionFilter });
    });

    it('does not import infrastructure (wired in AppModule)', () => {
        // Arrange: InterfaceModule metadata

        // Act
        const imports = metadata('imports');

        // Assert
        expect(imports).toContain(ApplicationModule);
        expect(imports.map((m) => (m as { name?: string }).name)).not.toContain(
            'InfrastructureModule',
        );
    });
});
