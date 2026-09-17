import { ProviderFactory } from '@common/factories';
import { Global, Module } from '@nestjs/common';
import { ConfigPortToken } from './config.token';
import { EnvConfigAdapter } from './env-config.adapter';

@Global()
@Module({
    providers: [ProviderFactory.class(ConfigPortToken, EnvConfigAdapter)],
    exports: [ConfigPortToken],
})
export class ConfigModule {}
