/**

* Cross-cutting types and metadata for structured logging.

*

* Purpose:

*- Define the shape of all log metadata (LogMeta)

*- Keep consistent log field naming across app & infrastructure

*- Purely application-level — no NestJS, Pino, or infra imports

*/

/**

* Allowed log levels for structured logs.

* These are the same logical levels across all layers.

*/

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**

* Common metadata that accompanies every log entry.

* This ensures logs are queryable, correlated, and safe.

*/

export interface LogMeta {
    /** Optional Name of the service (microservice or bounded context) Note: May need this later*/
    service?: string;
    /** Current runtime environment (e.g., dev, staging, prod) */
    env?: string;

    /** Unique correlation ID for tracing a single request */
    correlationId?: string;
    /** Optional distributed trace identifiers (for APM/OTel integration) */
    traceId?: string;

    spanId?: string;

    /** Logical context inside the app (use case name, etc.) */
    useCase?: string;

    /** Aggregate root and instance involved (for DDD tracing) */
    aggregate?: string;

    aggregateId?: string;

    /** HTTP request/response info (populated in interface layer) */
    http?: {
        method: string;
        url: string;
        status?: number;
        latencyMs?: number;
    };

    /** Integration (external call) info */
    integration?: {
        name: string;
        target?: string;
        status?: number;
        latencyMs?: number;
    };

    /** Optional attached error (structured object, not just string) */
    error?: unknown;

    /** Allow extra ad-hoc metadata (e.g., userId, sessionId, etc.) */
    [key: string]: unknown;
}

/**

* Shape of a structured log record (optional utility type).

* Can be used internally for advanced logging implementations.

*/

export interface LogRecord {
    level: LogLevel;
    message: string;
    meta?: Partial<LogMeta>;
}
