import { ConfigPortToken, type ConfigPort } from '@application/ports';
import { ProviderFactory } from '@common/factories';
import { Global, Module } from '@nestjs/common';
import { ThrottlerModule, type ThrottlerStorage } from '@nestjs/throttler';
import { createThrottlerStorage } from './throttler-storage.factory';
import { ThrottlerStorageToken } from './throttler-storage.token';

/**
 * Storage choice and TTL are configuration, i.e. infrastructure; the `ThrottlerGuard` itself
 * stays in `InterfaceModule` since applying it to HTTP requests is interface's job.
 */
@Global()
@Module({
    imports: [
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
    providers: [
        ProviderFactory.factory(
            ThrottlerStorageToken,
            (config: ConfigPort) => createThrottlerStorage(config),
            [ConfigPortToken],
        ),
    ],
    exports: [ThrottlerStorageToken, ThrottlerModule],
})
export class ThrottlingModule {}
