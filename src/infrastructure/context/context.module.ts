import { RequestContextPortToken } from '@application/ports';
import { ProviderFactory } from '@common/factories';
import { Global, Module } from '@nestjs/common';
import { AsyncRequestContext } from './async-request-context';

/** Global: the correlation id is read by the HTTP client and anything else that calls out. */
@Global()
@Module({
    providers: [ProviderFactory.class(RequestContextPortToken, AsyncRequestContext)],
    exports: [RequestContextPortToken],
})
export class ContextModule {}
