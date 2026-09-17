import {
    ConfigPortToken,
    LoggerPortToken,
    RequestContextPortToken,
    type ConfigPort,
    type LoggerPort,
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
            (config: ConfigPort, logger: LoggerPort, context: RequestContextPort) =>
                new FetchHttpClient(config, logger, context),
            [ConfigPortToken, LoggerPortToken, RequestContextPortToken],
        ),
    ],
    exports: [HttpClientToken],
})
export class HttpModule {}
