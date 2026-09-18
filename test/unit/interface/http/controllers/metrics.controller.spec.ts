import { NotFoundError } from '@application/errors';
import type { MetricsScrapePort } from '@application/ports';
import { MetricsController } from '@interface/http/controllers';
import type { Response } from 'express';

const fakeResponse = () => ({ setHeader: jest.fn() });

describe('MetricsController', () => {
    it('renders the scrape body and sets the registry content type', async () => {
        // Arrange
        const metrics: MetricsScrapePort = {
            contentType: 'text/plain; version=0.0.4',
            render: jest.fn(() => Promise.resolve('metrics_total 1\n')),
        };
        const sut = new MetricsController(metrics);
        const res = fakeResponse();

        // Act
        const body = await sut.scrape(res as unknown as Response);

        // Assert
        expect(body).toBe('metrics_total 1\n');
        expect(res.setHeader).toHaveBeenCalledWith('content-type', 'text/plain; version=0.0.4');
    });

    it('answers 404 when metrics are disabled, so "off" reads differently from "no data"', async () => {
        // Arrange
        const sut = new MetricsController(null);
        const res = fakeResponse();

        // Act
        const call = sut.scrape(res as unknown as Response);

        // Assert
        await expect(call).rejects.toBeInstanceOf(NotFoundError);
    });
});
