import { ShutdownPortToken } from '@application/ports';
import { ProviderFactory } from '@common/factories';
import { Global, Module } from '@nestjs/common';
import { ShutdownState } from './shutdown-state';

/** Global: the readiness probe and the signal handler share one flag. */
@Global()
@Module({
    providers: [ProviderFactory.class(ShutdownPortToken, ShutdownState)],
    exports: [ShutdownPortToken],
})
export class LifecycleModule {}
