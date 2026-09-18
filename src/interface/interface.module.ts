import { ApplicationModule } from '@application';
import { ProviderFactory } from '@common/factories';
import {
    DatabaseInfoController,
    HealthController,
    MetricsController,
} from '@interface/http/controllers';
import { CsrfGuard, JwtGuard, RolesGuard } from '@interface/http/guards';
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import { FallbackController } from './http/common/fallback/fallback.controller';
import { ResponseFormatterInterceptor } from './http/common/interceptors/response-formatter.interceptor';
import { ErrorPresenter } from './http/error-presenter';
import { GlobalExceptionFilter } from './http/global-exception.filter';
import { MetricsInterceptor } from './http/interceptors/metrics.interceptor';
import { ZodHttpInterceptor } from './http/interceptors/zod-http.interceptor';
import { RequestContextMiddleware } from './http/middleware';

@Module({
    imports: [ApplicationModule],
    // FallbackController must stay last: its catch-all route would shadow later controllers
    controllers: [HealthController, MetricsController, DatabaseInfoController, FallbackController],
    providers: [
        ErrorPresenter,
        ProviderFactory.class(APP_GUARD, ThrottlerGuard),
        ProviderFactory.class(APP_GUARD, CsrfGuard),
        // authentication is global: routes open up with @Public(), they don't opt in
        ProviderFactory.class(APP_GUARD, JwtGuard),
        // roles from the token; routes without @Roles() are unaffected
        ProviderFactory.class(APP_GUARD, RolesGuard),
        // first interceptor: its timer wraps everything the others do
        ProviderFactory.class(APP_INTERCEPTOR, MetricsInterceptor),
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
