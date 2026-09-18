import type { MetricLabels, MetricsPort } from '@application/ports';
import { MetricsInterceptor } from '@interface/http/interceptors/metrics.interceptor';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Metrics } from '@shared/metrics';
import { lastValueFrom, of, throwError } from 'rxjs';

type Recorded = { name: string; labels?: MetricLabels };

/** Stands in for the response: metrics are recorded when it finishes, not when the handler returns. */
const responseThatFinishes = (statusCode: number) => {
    const listeners: Array<() => void> = [];
    return {
        response: {
            statusCode,
            once: (event: string, listener: () => void) => {
                if (event === 'finish') listeners.push(listener);
            },
        },
        finish: (finalStatus = statusCode) => {
            listeners.forEach((listener) => {
                listeners.length = 0;
                listener();
            });
            return finalStatus;
        },
    };
};

const contextFor = (req: Record<string, unknown>, res: object, type: 'http' | 'rpc' = 'http') =>
    ({
        getType: () => type,
        switchToHttp: () => ({
            getRequest: () => req,
            getResponse: () => res,
        }),
    }) as unknown as ExecutionContext;

describe('MetricsInterceptor', () => {
    const counted: Recorded[] = [];
    const observed: Recorded[] = [];
    const metrics: MetricsPort = {
        increment: (name, labels) => void counted.push({ name, labels }),
        observe: (name, _value, labels) => void observed.push({ name, labels }),
        setGauge: jest.fn(),
    };
    const sut = new MetricsInterceptor(metrics);

    afterEach(() => {
        counted.length = 0;
        observed.length = 0;
    });

    it('labels a request with its route template, not the URL', async () => {
        // Arrange
        const { response, finish } = responseThatFinishes(200);
        const context = contextFor(
            {
                method: 'GET',
                originalUrl: '/v1/tickets/t-42',
                baseUrl: '/v1/tickets',
                route: { path: '/:id' },
            },
            response,
        );
        const next: CallHandler = { handle: () => of({ id: 't-42' }) };

        // Act
        await lastValueFrom(sut.intercept(context, next));
        finish();

        // Assert: one series per endpoint, not one per ticket id
        expect(counted).toEqual([
            {
                name: Metrics.httpServerRequests,
                labels: { method: 'GET', route: '/v1/tickets/:id', status: 200 },
            },
        ]);
    });

    it('times the request as well as counting it', async () => {
        // Arrange
        const { response, finish } = responseThatFinishes(200);
        const context = contextFor(
            { method: 'GET', baseUrl: '', route: { path: '/health' } },
            response,
        );
        const next: CallHandler = { handle: () => of('ok') };

        // Act
        await lastValueFrom(sut.intercept(context, next));
        finish();

        // Assert
        expect(observed[0]?.name).toBe(Metrics.httpServerDuration);
    });

    it('records the status the exception filter finally sent, not the one at handler time', async () => {
        // Arrange
        const { response, finish } = responseThatFinishes(200);
        const context = contextFor(
            { method: 'POST', baseUrl: '/v1/tickets', route: { path: '/' } },
            response,
        );
        const next: CallHandler = { handle: () => throwError(() => new Error('conflict')) };

        // Act
        await lastValueFrom(sut.intercept(context, next)).catch(() => undefined);
        response.statusCode = 409; // the filter maps the error, then the response finishes
        finish();

        // Assert
        expect(counted[0]?.labels).toMatchObject({ status: 409, route: '/v1/tickets' });
    });

    it('lumps unmatched paths together instead of labelling by URL', async () => {
        // Arrange: no route matched, so there is no template to label with
        const { response, finish } = responseThatFinishes(404);
        const context = contextFor({ method: 'GET', originalUrl: '/v1/nope' }, response);
        const next: CallHandler = { handle: () => of(undefined) };

        // Act
        await lastValueFrom(sut.intercept(context, next));
        finish();

        // Assert
        expect(counted[0]?.labels).toMatchObject({ route: 'unmatched', status: 404 });
    });

    it('ignores non-HTTP contexts', async () => {
        // Arrange
        const { response } = responseThatFinishes(200);
        const context = contextFor({}, response, 'rpc');
        const next: CallHandler = { handle: () => of('ok') };

        // Act
        await lastValueFrom(sut.intercept(context, next));

        // Assert
        expect(counted).toHaveLength(0);
    });
});
