/**
 * One place for metric names, so a dashboard query and the code that emits it can't drift.
 * Prometheus convention: `_total` for counters, base unit (seconds, bytes) in the name.
 */
export const Metrics = {
    httpServerRequests: 'http_server_requests_total',
    httpServerDuration: 'http_server_request_duration_seconds',
    httpClientRequests: 'http_client_requests_total',
    httpClientDuration: 'http_client_request_duration_seconds',
    httpClientRetries: 'http_client_retries_total',
    httpClientCircuitOpen: 'http_client_circuit_open_total',
    jobRuns: 'scheduled_job_runs_total',
    jobDuration: 'scheduled_job_duration_seconds',
    dbPoolConnections: 'database_pool_connections',
    domainEventsPublished: 'domain_events_published_total',
    domainEventHandlerFailures: 'domain_event_handler_failures_total',
    idempotencyRequests: 'idempotency_requests_total',
} as const;

export type MetricName = (typeof Metrics)[keyof typeof Metrics];
