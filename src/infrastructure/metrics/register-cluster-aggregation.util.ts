import { AggregatorRegistry } from 'prom-client';
import type { PrometheusMetrics } from './prometheus-metrics';

/**
 * Opts this worker's registry into `AggregatorRegistry.clusterMetrics()`, which the primary's
 * small `node:http` metrics server (`cluster-metrics-server.ts`) calls to serve one aggregated
 * `/metrics` for the whole cluster. Without this, `AggregatorRegistry` aggregates prom-client's
 * *global* registry by default — `PrometheusMetrics` never registers onto that one, so the
 * primary would always see an empty aggregate.
 *
 * Constructing an `AggregatorRegistry` here (even though only the primary's instance is ever
 * queried) is what attaches prom-client's own `process.on('message', ...)` listener in this
 * worker: `addListeners()` is a private module function only reachable through that constructor,
 * and only runs its worker branch when `cluster.isWorker` is true — which it is, since this only
 * runs when `cluster.enabled` is true, and the primary never builds a Nest application (so never
 * reaches this code) — see decision 0012.
 */
export function registerForClusterAggregation(metrics: PrometheusMetrics): void {
    AggregatorRegistry.setRegistries(metrics.registryForAggregation);
    new AggregatorRegistry();
}
