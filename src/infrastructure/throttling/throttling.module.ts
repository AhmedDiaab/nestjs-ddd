import { ConfigPortToken, type ConfigPort } from '@application/ports';
import { ProviderFactory } from '@common/factories';
import { Global, Module } from '@nestjs/common';
import { createThrottlerStorage } from './throttler-storage.factory';
import { ThrottlerStorageToken } from './throttler-storage.token';

@Global()
@Module({
    providers: [
        ProviderFactory.factory(
            ThrottlerStorageToken,
            (config: ConfigPort) => createThrottlerStorage(config),
            [ConfigPortToken],
        ),
    ],
    exports: [ThrottlerStorageToken],
})
export class ThrottlingModule {}
