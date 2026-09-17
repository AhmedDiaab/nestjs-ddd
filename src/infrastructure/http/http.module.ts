import {
    ConfigPortToken,
    LoggerPortToken,
    MetricsPortToken,
    RequestContextPortToken,
    type ConfigPort,
    type LoggerPort,
    type MetricsPort,
    type RequestContextPort,
} from '@application/ports';
import { ProviderFactory } from '@common/factories';
import { Global, Module } from '@nestjs/common';
import { FetchHttpClient } from './fetch-http.client';
import { HttpClientToken } from './http-client.token';

/** Global: gateways inject `HttpClientToken` wherever they live. */
@Global()
@Module({
    providers: [
        ProviderFactory.factory(
            HttpClientToken,
            (
                config: ConfigPort,
                logger: LoggerPort,
                context: RequestContextPort,
                metrics: MetricsPort,
            ) => new FetchHttpClient(config, logger, context, metrics),
            [ConfigPortToken, LoggerPortToken, RequestContextPortToken, MetricsPortToken],
        ),
    ],
    exports: [HttpClientToken],
})
export class HttpModule {}
