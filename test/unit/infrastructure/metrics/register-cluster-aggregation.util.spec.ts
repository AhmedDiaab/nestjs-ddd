import { PrometheusMetrics, registerForClusterAggregation } from '@infrastructure/metrics';
import { AggregatorRegistry } from 'prom-client';

describe('registerForClusterAggregation', () => {
    afterEach(() => jest.restoreAllMocks());

    it('opts the metrics registry into prom-client cluster aggregation', () => {
        // Arrange
        const setRegistries = jest.spyOn(AggregatorRegistry, 'setRegistries');
        const metrics = new PrometheusMetrics('orders-api', false);

        // Act
        registerForClusterAggregation(metrics);

        // Assert
        expect(setRegistries).toHaveBeenCalledWith(metrics.registryForAggregation);
    });
});
