import { MetricsPortToken, type MetricsPort } from '@application/ports';
import {
    Inject,
    Injectable,
    type CallHandler,
    type ExecutionContext,
    type NestInterceptor,
} from '@nestjs/common';
import { Metrics } from '@shared/metrics';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';

/**
 * Counts and times every request.
 *
 * The `route` label is the **route template** (`/v1/tickets/:id`), never the URL: one time
 * series per endpoint instead of one per id, which is what makes a metric useless (and
 * expensive) at scale.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
    constructor(@Inject(MetricsPortToken) private readonly metrics: MetricsPort) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        if (context.getType() !== 'http') return next.handle();

        const http = context.switchToHttp();
        const req = http.getRequest<Request>();
        const res = http.getResponse<Response>();
        const startedAt = process.hrtime.bigint();

        // on 'finish', not when the handler returns: by then the exception filter has set the
        // real status, so a failure isn't recorded as the 200 the response still carried
        res.once('finish', () => {
            const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
            const labels = {
                method: req.method,
                route: routeOf(req),
                status: res.statusCode,
            };

            this.metrics.increment(Metrics.httpServerRequests, labels);
            this.metrics.observe(Metrics.httpServerDuration, seconds, labels);
        });

        return next.handle();
    }
}

/** Express fills `req.route` once a handler matched; anything else is lumped together. */
function routeOf(req: Request): string {
    const route: unknown = (req as { route?: unknown }).route;
    const path: unknown =
        typeof route === 'object' && route ? (route as { path?: unknown }).path : undefined;
    if (typeof path !== 'string') return 'unmatched';

    const base = req.baseUrl || '';
    return `${base}${path}`.replace(/\/$/, '') || '/';
}
