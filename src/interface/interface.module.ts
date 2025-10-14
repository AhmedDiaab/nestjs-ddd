import { ProviderFactory } from '@common/factories/provider.factory';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { FallbackController } from './http/common/fallback/fallback.controller';
import { ResponseFormatterInterceptor } from './http/common/interceptors/response-formatter.interceptor';
import { ErrorPresenter } from './http/error-presenter';
import { GlobalExceptionFilter } from './http/global-exception.filter';
import { ZodHttpInterceptor } from './http/interceptors/zod-http.interceptor';

@Module({
    imports: [],
    controllers: [FallbackController],
    providers: [
        ErrorPresenter,
        ProviderFactory.create(APP_INTERCEPTOR, ZodHttpInterceptor),
        ProviderFactory.create(APP_INTERCEPTOR, ResponseFormatterInterceptor),
        ProviderFactory.create(APP_FILTER, GlobalExceptionFilter),
    ],
    exports: [ErrorPresenter],
})
export class InterfaceModule {}
