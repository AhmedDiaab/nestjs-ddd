import { createServer, type Server } from 'node:http';
import type { LoggerPort } from '@application/ports';
import { AggregatorRegistry } from 'prom-client';

export type StartClusterMetricsServerDeps = {
    port: number;
    logger: LoggerPort;
};

/**
 * Aggregated `/metrics` for the whole cluster, served by the primary on `CLUSTER_METRICS_PORT`.
 * `prom-client`'s `AggregatorRegistry` only aggregates from the primary process — a worker's own
 * `GET /metrics` (served by Nest's `MetricsController`) keeps answering with just that worker's
 * numbers, so scraping a random worker in cluster mode undercounts. Scrape this port instead when
 * clustered; see `docs/architecture/operations.md` § Process model and decision 0012.
 *
 * A small plain `node:http` server, not Nest: the primary never builds a Nest application.
 */
export function startClusterMetricsServer({ port, logger }: StartClusterMetricsServerDeps): Server {
    const registry = new AggregatorRegistry();

    const server = createServer((req, res) => {
        if (req.method !== 'GET' || req.url !== '/metrics') {
            res.writeHead(404).end();
            return;
        }

        registry
            .clusterMetrics()
            .then((metrics) => {
                res.writeHead(200, { 'content-type': registry.contentType });
                res.end(metrics);
            })
            .catch((error: unknown) => {
                logger.error('cluster.metrics.scrape.failed', { error });
                res.writeHead(500).end();
            });
    });

    server.on('error', (error) => logger.error('cluster.metrics.server.failed', { error, port }));
    server.listen(port, () => logger.info('cluster.metrics.listening', { port }));

    return server;
}
