import { ApplicationModule } from '@application';
import type { ConfigPort } from '@application/ports';
import { ConfigPortToken } from '@application/ports';
import { ProviderFactory } from '@common/factories';
import { ThrottlerStorageToken } from '@infrastructure/throttling';
import { DatabaseInfoController, HealthController } from '@interface/http/controllers';
import { CsrfGuard, JwtGuard, RolesGuard } from '@interface/http/guards';
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';
import { FallbackController } from './http/common/fallback/fallback.controller';
import { ResponseFormatterInterceptor } from './http/common/interceptors/response-formatter.interceptor';
import { ErrorPresenter } from './http/error-presenter';
import { GlobalExceptionFilter } from './http/global-exception.filter';
import { ZodHttpInterceptor } from './http/interceptors/zod-http.interceptor';
import { RequestContextMiddleware } from './http/middleware';

@Module({
    imports: [
        ApplicationModule,
        ThrottlerModule.forRootAsync({
            inject: [ConfigPortToken, ThrottlerStorageToken],
            useFactory: (config: ConfigPort, storage: ThrottlerStorage | null) => {
                const limit = config.get('http.throttleLimit');
                return {
                    throttlers: [{ ttl: config.get('http.throttleTtlMs'), limit }],
                    skipIf: () => limit === 0,
                    storage: storage ?? undefined,
                };
            },
        }),
    ],
    // FallbackController must stay last: its catch-all route would shadow later controllers
    controllers: [HealthController, DatabaseInfoController, FallbackController],
    providers: [
        ErrorPresenter,
        ProviderFactory.class(APP_GUARD, ThrottlerGuard),
        ProviderFactory.class(APP_GUARD, CsrfGuard),
        // authentication is global: routes open up with @Public(), they don't opt in
        ProviderFactory.class(APP_GUARD, JwtGuard),
        // roles from the token; routes without @Roles() are unaffected
        ProviderFactory.class(APP_GUARD, RolesGuard),
        ProviderFactory.class(APP_INTERCEPTOR, ZodHttpInterceptor),
        ProviderFactory.class(APP_INTERCEPTOR, ResponseFormatterInterceptor),
        ProviderFactory.class(APP_FILTER, GlobalExceptionFilter),
    ],
    exports: [ErrorPresenter],
})
export class InterfaceModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        // every route, including the fallback: a 404 is worth correlating too
        consumer.apply(RequestContextMiddleware).forRoutes('*all');
    }
}
