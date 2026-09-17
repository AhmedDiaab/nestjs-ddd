import { ApplicationModule } from '@application';
import type { ConfigPort } from '@application/ports';
import { ConfigPortToken } from '@application/ports';
import { ProviderFactory } from '@common/factories';
import { DatabaseInfoController, HealthController } from '@interface/http/controllers';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { FallbackController } from './http/common/fallback/fallback.controller';
import { ResponseFormatterInterceptor } from './http/common/interceptors/response-formatter.interceptor';
import { ErrorPresenter } from './http/error-presenter';
import { GlobalExceptionFilter } from './http/global-exception.filter';
import { ZodHttpInterceptor } from './http/interceptors/zod-http.interceptor';

@Module({
    imports: [
        ApplicationModule,
        ThrottlerModule.forRootAsync({
            inject: [ConfigPortToken],
            useFactory: (config: ConfigPort) => {
                const limit = config.get<number>('http.throttleLimit') ?? 100;
                return {
                    throttlers: [{ ttl: config.get<number>('http.throttleTtlMs') ?? 60000, limit }],
                    skipIf: () => limit === 0,
                };
            },
        }),
    ],
    // FallbackController must stay last: its catch-all route would shadow later controllers
    controllers: [HealthController, DatabaseInfoController, FallbackController],
    providers: [
        ErrorPresenter,
        ProviderFactory.class(APP_GUARD, ThrottlerGuard),
        ProviderFactory.class(APP_INTERCEPTOR, ZodHttpInterceptor),
        ProviderFactory.class(APP_INTERCEPTOR, ResponseFormatterInterceptor),
        ProviderFactory.class(APP_FILTER, GlobalExceptionFilter),
    ],
    exports: [ErrorPresenter],
})
export class InterfaceModule {}
