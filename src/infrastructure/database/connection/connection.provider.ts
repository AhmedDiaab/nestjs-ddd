import type { ConfigPort } from '@application/ports';
import { ConfigPortToken } from '@application/ports';
import { ProviderFactory } from '@common/factories';
import type { ConnectionProvider as DBConnectionProvider } from '@infrastructure/database/contracts';
import type { Provider } from '@nestjs/common';
import { ConnectionProviderToken } from './connection-provider.token';
import { PoolManager } from './pool.manager';

export const ConnectionProvider: Provider = ProviderFactory.factory(
    ConnectionProviderToken,
    async (config: ConfigPort, manager: PoolManager) => {
        // already validated by EnvConfigAdapter; undefined when DATABASE_CONFIG_JSON is unset
        const database = config.get('database');
        if (!database) return manager as DBConnectionProvider;

        await manager.init(database);
        // ping databases at start, if pingOnBoot is enabled
        if (database.health.pingOnBoot) {
            await manager.pingAll({
                timeoutMs: database.health.timeoutMs,
                retries: database.health.maxRetries,
                requiredSet: new Set(database.health.requiredSources),
                concurrency: database.health.concurrency,
                jitterMs: database.health.jitterMs,
            });
        }
        return manager as DBConnectionProvider;
    },
    [ConfigPortToken, PoolManager],
);
