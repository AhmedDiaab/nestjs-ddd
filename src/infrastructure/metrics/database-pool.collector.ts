import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { Metrics } from './metric-names';
import type { PrometheusMetrics } from './prometheus-metrics';

/**
 * Fills the pool gauges when Prometheus scrapes, rather than polling in the background:
 * nothing is measured when nobody is looking, and the numbers are never stale.
 */
export function collectDatabasePoolMetrics(
    metrics: PrometheusMetrics,
    db: Pick<ConnectionProvider, 'poolStats'>,
): void {
    metrics.onScrape(() => {
        for (const [source, stats] of Object.entries(db.poolStats())) {
            if (!stats) continue;
            // the driver decides what it reports; only the counters we graph are read
            for (const [key, state] of [
                ['connectionsOpen', 'open'],
                ['connectionsInUse', 'in_use'],
            ] as const) {
                const value = stats[key];
                if (typeof value === 'number') {
                    metrics.setGauge(Metrics.dbPoolConnections, value, { source, state });
                }
            }
        }
    });
}
