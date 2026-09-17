import { createToken } from '@shared';

/** Label values are part of the metric's identity: keep them bounded (no ids, no URLs). */
export type MetricLabels = Record<string, string | number>;

/**
 * Counters and histograms for the things worth alerting on.
 *
 * Deliberately small: a use case counts a business event, adapters record durations, and the
 * exposition format stays in infrastructure. Metrics are fire-and-forget — recording one must
 * never fail a request.
 */
export interface MetricsPort {
    /** Monotonic count: requests, failures, events. */
    increment(name: string, labels?: MetricLabels, value?: number): void;
    /** Distribution, in the metric's own unit (seconds for durations). */
    observe(name: string, value: number, labels?: MetricLabels): void;
    /** A value that goes up and down: queue depth, pool connections. */
    setGauge(name: string, value: number, labels?: MetricLabels): void;
}

export const MetricsPortToken = createToken<MetricsPort>('MetricsPort');
