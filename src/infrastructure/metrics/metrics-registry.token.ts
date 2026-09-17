import { createToken } from '@shared';
import type { PrometheusMetrics } from './prometheus-metrics';

/** The renderable registry, for the `/metrics` endpoint. `null` when metrics are disabled. */
export const MetricsRegistryToken = createToken<PrometheusMetrics | null>('MetricsRegistry');
