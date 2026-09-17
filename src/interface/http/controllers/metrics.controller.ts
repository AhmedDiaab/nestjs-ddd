import { NotFoundError } from '@application/errors';
import { MetricsRegistryToken, type PrometheusMetrics } from '@infrastructure/metrics';
import { Public, RawResponse } from '@interface/http/decorators';
import { Controller, Get, Header, Inject, Optional, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';

/**
 * Prometheus scrape target, present only when `METRICS_ENABLED` is on.
 *
 * Public and unthrottled like the health endpoints: a scraper has no token, and a scrape that
 * gets rate limited produces gaps exactly when traffic is high. Keep the port reachable only
 * from your monitoring network.
 */
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
    constructor(
        @Optional()
        @Inject(MetricsRegistryToken)
        private readonly registry: PrometheusMetrics | null,
    ) {}

    @Get()
    @RawResponse() // Prometheus parses the exposition format; an envelope would break the scrape
    @Header('cache-control', 'no-store')
    async scrape(@Res({ passthrough: true }) res: Response): Promise<string> {
        // 404 rather than an empty body: "metrics are off" should look different from "no data"
        if (!this.registry) throw new NotFoundError('Metrics are disabled');

        res.setHeader('content-type', this.registry.contentType);
        return this.registry.render();
    }
}
