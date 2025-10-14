import { ProviderFactory } from '@common/factories/provider.factory';
import { Global, Module } from '@nestjs/common';
import { ConfigPortToken } from './config.token';
import { EnvConfigAdapter } from './env-config.adapter';

@Global()
@Module({
    providers: [ProviderFactory.create(ConfigPortToken, EnvConfigAdapter)],
    exports: [ConfigPortToken],
})
export class ConfigModule {}
