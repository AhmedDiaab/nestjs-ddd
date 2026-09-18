import { createToken } from '@shared';

/**
 * Renders the current metrics snapshot for a scrape endpoint, without the controller knowing
 * the registry is prom-client.
 */
export interface MetricsScrapePort {
    readonly contentType: string;
    render(): Promise<string>;
}

/** `null` when metrics are disabled; the controller answers 404 rather than an empty scrape. */
export const MetricsScrapePortToken = createToken<MetricsScrapePort | null>('MetricsScrapePort');
