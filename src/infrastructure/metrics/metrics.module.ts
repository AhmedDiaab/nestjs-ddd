import {
    ConfigPortToken,
    MetricsPortToken,
    type ConfigPort,
    type MetricsPort,
} from '@application/ports';
import { ProviderFactory } from '@common/factories';
import { ConnectionProviderToken } from '@infrastructure/database/connection';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { Global, Module } from '@nestjs/common';
import { APP_NAME } from '@shared';
import { collectDatabasePoolMetrics } from './database-pool.collector';
import { MetricsRegistryToken } from './metrics-registry.token';
import { NoopMetrics } from './noop-metrics';
import { PrometheusMetrics } from './prometheus-metrics';

/**
 * Metrics are off unless `METRICS_ENABLED`: an instance that nobody scrapes shouldn't pay for
 * the bookkeeping, and `/metrics` shouldn't exist where it isn't wanted.
 */
@Global()
@Module({
    providers: [
        ProviderFactory.factory(
            MetricsRegistryToken,
            (config: ConfigPort, db: ConnectionProvider) => {
                if (!config.get('metrics.enabled')) return null;

                const metrics = new PrometheusMetrics(
                    APP_NAME,
                    config.get('metrics.defaultMetrics'),
                );
                collectDatabasePoolMetrics(metrics, db);
                return metrics;
            },
            [ConfigPortToken, ConnectionProviderToken],
        ),
        ProviderFactory.factory(
            MetricsPortToken,
            (registry: PrometheusMetrics | null): MetricsPort => registry ?? new NoopMetrics(),
            [MetricsRegistryToken],
        ),
    ],
    exports: [MetricsPortToken, MetricsRegistryToken],
})
export class MetricsModule {}
