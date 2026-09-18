# Observability

What this service exposes so you can tell what it is doing: structured logs, a trace that crosses services, and Prometheus metrics.

## The three, and what each answers

| You want to know                      | Use       | Where                                                           |
| ------------------------------------- | --------- | --------------------------------------------------------------- |
| "what happened in this one request?"  | logs      | [Logging](logging.md)                                           |
| "which of our services was slow?"     | trace ids | this page                                                       |
| "how is the service doing right now?" | metrics   | this page, `GET /metrics`                                       |
| "is it up / can it serve?"            | health    | [Operations → Health endpoints](operations.md#health-endpoints) |

## Correlation and tracing

Every request gets two identifiers, both set by `RequestContextMiddleware` before any guard runs:

| Id             | Comes from                                                                                    | Goes to                                                                         |
| -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Request id** | the caller's `x-request-id` (`REQUEST_ID_HEADER`) if it is safe to print, otherwise generated | every log line, the response `meta`, the response header, and outbound calls    |
| **Trace id**   | the caller's `traceparent` (W3C Trace Context) if valid, otherwise a new trace                | every log line, the `traceparent` sent to the next service, the response header |

```text
client ──traceparent: 00-4bf9…-a1b2…-01──► this service ──traceparent: 00-4bf9…-<new span>-01──► account API
                                            │
                                            └─ logs: { traceId: "4bf9…", spanId: "<new span>", requestId: "…" }
```

- **Ids from outside are checked.** A request id must match `[A-Za-z0-9._:-]{1,128}` or it is replaced, and a malformed `traceparent` is ignored rather than continued: both end up in every log line for that request, so they may not carry arbitrary bytes.
- **The sampling flag is passed on unchanged**, so a caller that decided not to sample stays unsampled through this service.
- **Outside a request** — boot, a cron job — there is no trace, and nothing is invented.

This is trace _context_, not a tracing backend: it gives you one id to grep across services and to hand to an APM agent, without spans or timings. Adding an OpenTelemetry SDK later means replacing the middleware, not the call sites.

## Metrics

Off by default. `METRICS_ENABLED=true` serves the Prometheus text format at `GET /metrics` — unauthenticated and unthrottled like the health endpoints, so keep the port on your monitoring network. Disabled, the endpoint answers **404**: "metrics are off" should look different from "no data".

| Metric                                 | Type      | Labels                      |
| -------------------------------------- | --------- | --------------------------- |
| `http_server_requests_total`           | counter   | `method`, `route`, `status` |
| `http_server_request_duration_seconds` | histogram | `method`, `route`, `status` |
| `http_client_requests_total`           | counter   | `tag`, `target`, `outcome`  |
| `http_client_request_duration_seconds` | histogram | `tag`, `target`             |
| `http_client_retries_total`            | counter   | `tag`, `target`             |
| `http_client_circuit_open_total`       | counter   | `tag`, `target`             |
| `scheduled_job_runs_total`             | counter   | `job`, `outcome`            |
| `scheduled_job_duration_seconds`       | histogram | `job`                       |
| `database_pool_connections`            | gauge     | `source`, `state`           |
| `domain_events_published_total`        | counter   | `event`                     |
| `domain_event_handler_failures_total`  | counter   | `event`                     |
| `idempotency_requests_total`           | counter   | `outcome`                   |

Plus Node and process metrics (heap, event loop lag, GC) unless `METRICS_DEFAULT_METRICS=false`, and a `service` label on everything, from `APP_NAME`.

`idempotency_requests_total`'s `outcome` is a closed set of five values (`claimed`, `replay`, `mismatch`, `in_progress`, `missing_key`), recorded by `IdempotencyInterceptor` for every request to a `@Idempotent()` route ([guide](../guides/make-an-endpoint-idempotent.md)) — bounded the same way `route` is, never the key itself.

### Rules that keep metrics cheap

- **Labels are bounded.** `route` is the route **template** (`/v1/tickets/:id`), never the URL: one series per endpoint, not one per id. Requests that match no route are labelled `unmatched`. Never put an id, email, URL or free text in a label — each distinct value is a new time series, kept in memory here and in Prometheus.
- **Metrics are declared up front** in `PrometheusMetrics`. A name that was never declared is ignored, so a typo can't quietly create a series nobody watches.
- **Recording never fails a request.** `MetricsPort` returns `void`; when metrics are off the implementation is a no-op and call sites stay unchanged.
- **Gauges are filled at scrape time.** Pool counters are read when Prometheus asks, so nothing is polled in the background and the numbers are never stale.
- **The status is the one actually sent.** HTTP metrics are recorded when the response finishes, after the exception filter has mapped an error, so a 409 is not counted as the 200 the response still carried when the handler returned.

### Recording something of your own

```ts
constructor(@Inject(MetricsPortToken) private readonly metrics: MetricsPort) {}

this.metrics.increment(Metrics.jobRuns, { job: 'tickets.closeStale', outcome: 'succeeded' });
```

Declare the metric in `PrometheusMetrics` first, and add its name to `src/shared/metrics/metric-names.ts` (re-exported from `@shared/metrics`) so the dashboard query and the code that emits it can't drift.

### Worth alerting on

| Signal                                                          | Why                                                                                                                                                             |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5xx rate by `route`                                             | the thing users feel                                                                                                                                            |
| p95 of `http_server_request_duration_seconds`                   | slow before it is broken                                                                                                                                        |
| `http_client_circuit_open_total` increasing                     | a dependency is failing and being shed                                                                                                                          |
| `scheduled_job_runs_total{outcome="failed"}`, or no runs at all | a job that silently stops is the failure nobody notices                                                                                                         |
| `database_pool_connections{state="in_use"}` near `poolMax`      | requests are about to queue for a connection                                                                                                                    |
| `domain_event_handler_failures_total` by `event`                | a handler that fails on every event is otherwise visible only in logs (see [Application layer → Delivery guarantees](application-layer.md#delivery-guarantees)) |

## Logs

Structured JSON with the request id, trace id and span id on every line ([Logging](logging.md)). Successful health polls are not logged; bodies, headers and query strings are never logged by the HTTP client.
