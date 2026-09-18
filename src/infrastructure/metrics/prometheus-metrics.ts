import type { MetricLabels, MetricsPort, MetricsScrapePort } from '@application/ports';
import { Metrics } from '@shared/metrics';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

/** Buckets in seconds, tuned for an HTTP API rather than prom-client's defaults. */
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/**
 * Metrics are declared up front, not created on first use: a typo in a name would otherwise
 * become a new time series nobody is watching, and label sets could grow without review.
 */
export class PrometheusMetrics implements MetricsPort, MetricsScrapePort {
    private readonly registry = new Registry();
    private readonly counters = new Map<string, Counter>();
    private readonly histograms = new Map<string, Histogram>();
    private readonly gauges = new Map<string, Gauge>();
    private readonly collectors: Array<() => void | Promise<void>> = [];

    constructor(appName: string, withDefaults = true) {
        this.registry.setDefaultLabels({ service: appName });
        if (withDefaults) collectDefaultMetrics({ register: this.registry });

        this.counter(Metrics.httpServerRequests, 'HTTP requests served', [
            'method',
            'route',
            'status',
        ]);
        this.histogram(Metrics.httpServerDuration, 'Time to serve an HTTP request', [
            'method',
            'route',
            'status',
        ]);
        this.counter(Metrics.httpClientRequests, 'Outbound HTTP calls', [
            'tag',
            'target',
            'outcome',
        ]);
        this.histogram(Metrics.httpClientDuration, 'Time of an outbound HTTP call', [
            'tag',
            'target',
        ]);
        this.counter(Metrics.httpClientRetries, 'Outbound HTTP attempts retried', [
            'tag',
            'target',
        ]);
        this.counter(Metrics.httpClientCircuitOpen, 'Calls refused by an open circuit', [
            'tag',
            'target',
        ]);
        this.counter(Metrics.jobRuns, 'Scheduled job runs', ['job', 'outcome']);
        this.histogram(Metrics.jobDuration, 'Time of a scheduled job run', ['job']);
        this.gauge(Metrics.dbPoolConnections, 'Database pool connections', ['source', 'state']);
        this.counter(Metrics.domainEventsPublished, 'Domain events dispatched to their handlers', [
            'event',
        ]);
        this.counter(
            Metrics.domainEventHandlerFailures,
            'Domain event handlers that threw instead of completing',
            ['event'],
        );
    }

    increment(name: string, labels: MetricLabels = {}, value = 1): void {
        this.counters.get(name)?.inc(this.stringify(labels), value);
    }

    observe(name: string, value: number, labels: MetricLabels = {}): void {
        this.histograms.get(name)?.observe(this.stringify(labels), value);
    }

    setGauge(name: string, value: number, labels: MetricLabels = {}): void {
        this.gauges.get(name)?.set(this.stringify(labels), value);
    }

    /** Lets a collector fill gauges at scrape time instead of polling in the background. */
    onScrape(collect: () => void | Promise<void>): void {
        this.collectors.push(collect);
    }

    async render(): Promise<string> {
        // gauges are filled when someone actually looks, so the numbers are never stale
        await Promise.all(this.collectors.map(async (collect) => collect()));
        return this.registry.metrics();
    }

    get contentType(): string {
        return this.registry.contentType;
    }

    private counter(name: string, help: string, labelNames: string[]): void {
        this.counters.set(
            name,
            new Counter({ name, help, labelNames, registers: [this.registry] }),
        );
    }

    private histogram(name: string, help: string, labelNames: string[]): void {
        this.histograms.set(
            name,
            new Histogram({
                name,
                help,
                labelNames,
                buckets: LATENCY_BUCKETS,
                registers: [this.registry],
            }),
        );
    }

    private gauge(name: string, help: string, labelNames: string[]): void {
        this.gauges.set(name, new Gauge({ name, help, labelNames, registers: [this.registry] }));
    }

    private stringify(labels: MetricLabels): Record<string, string> {
        return Object.fromEntries(
            Object.entries(labels).map(([key, value]) => [key, String(value)]),
        );
    }
}
