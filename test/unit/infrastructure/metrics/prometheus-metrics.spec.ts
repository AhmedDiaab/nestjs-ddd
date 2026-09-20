import { collectDatabasePoolMetrics, Metrics, PrometheusMetrics } from '@infrastructure/metrics';

describe('PrometheusMetrics', () => {
    it('renders a declared counter with its labels and the service label', async () => {
        // Arrange
        const sut = new PrometheusMetrics('orders-api', false);

        // Act
        sut.increment(Metrics.httpServerRequests, { method: 'GET', route: '/v1', status: 200 });
        const body = await sut.render();

        // Assert
        expect(body).toContain(
            'http_server_requests_total{method="GET",route="/v1",status="200",service="orders-api"} 1',
        );
    });

    it('adds up repeated increments', async () => {
        // Arrange
        const sut = new PrometheusMetrics('orders-api', false);
        const labels = { method: 'GET', route: '/v1', status: 200 };

        // Act
        sut.increment(Metrics.httpServerRequests, labels);
        sut.increment(Metrics.httpServerRequests, labels, 2);
        const body = await sut.render();

        // Assert
        expect(body).toContain('route="/v1",status="200",service="orders-api"} 3');
    });

    it('records a duration into histogram buckets', async () => {
        // Arrange
        const sut = new PrometheusMetrics('orders-api', false);

        // Act
        sut.observe(Metrics.httpServerDuration, 0.03, { method: 'GET', route: '/v1', status: 200 });
        const body = await sut.render();

        // Assert
        expect(body).toContain('http_server_request_duration_seconds_bucket');
        expect(body).toContain('http_server_request_duration_seconds_sum');
    });

    it('ignores a metric that was never declared, instead of inventing a series', async () => {
        // Arrange
        const sut = new PrometheusMetrics('orders-api', false);

        // Act
        sut.increment('typo_requests_total', { any: 'label' });
        const body = await sut.render();

        // Assert
        expect(body).not.toContain('typo_requests_total');
    });

    it('fills gauges at scrape time, so the numbers are never stale', async () => {
        // Arrange
        const sut = new PrometheusMetrics('orders-api', false);
        let open = 2;
        collectDatabasePoolMetrics(sut, {
            poolStats: () => ({ main: { connectionsOpen: open, connectionsInUse: 1 } }),
        });

        // Act
        const first = await sut.render();
        open = 7;
        const second = await sut.render();

        // Assert
        expect(first).toContain(
            'database_pool_connections{source="main",state="open",service="orders-api"} 2',
        );
        expect(second).toContain(
            'database_pool_connections{source="main",state="open",service="orders-api"} 7',
        );
    });

    it('skips pool counters the driver does not report', async () => {
        // Arrange
        const sut = new PrometheusMetrics('orders-api', false);
        collectDatabasePoolMetrics(sut, { poolStats: () => ({ main: { poolAlias: 'main' } }) });

        // Act
        const body = await sut.render();

        // Assert
        expect(body).not.toContain('database_pool_connections{');
    });

    it('includes process metrics only when asked for them', async () => {
        // Arrange
        const withDefaults = new PrometheusMetrics('orders-api', true);

        // Act
        const body = await withDefaults.render();

        // Assert
        expect(body).toContain('process_cpu_user_seconds_total');
    });

    it('exposes its underlying registry for cluster aggregation', async () => {
        // Arrange
        const sut = new PrometheusMetrics('orders-api', false);
        sut.increment(Metrics.httpServerRequests, { method: 'GET', route: '/v1', status: 200 });

        // Act
        const body = await sut.registryForAggregation.metrics();

        // Assert
        expect(body).toContain('http_server_requests_total');
    });
});
