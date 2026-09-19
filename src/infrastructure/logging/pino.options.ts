import { randomUUID } from 'node:crypto';
import { type IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { ConfigPort } from '@application/ports';
import { formatStackTrace, resolveErrorOrigin } from '@common/utils';
import { isSafeCorrelationId } from '@shared';
import type { Response } from 'express';
import type { Params } from 'nestjs-pino';
import type { TransportTargetOptions } from 'pino';

function fileRotationTarget(config: ConfigPort): TransportTargetOptions | undefined {
    if (!config.get('logging.toFile')) return undefined;

    const logDirectory = config.get('logging.directory');
    const logFileName = config.get('logging.fileName');
    const logFilesLimit = config.get('logging.filesLimit');
    const maxSize = config.get('logging.maxSize');

    return {
        target: 'pino-roll',
        level: config.get('logging.logLevel'),
        options: {
            file: join(logDirectory, logFileName),
            frequency: 'daily',
            mkdir: true,
            size: maxSize,
            limit: {
                count: logFilesLimit + 1, // mean if 14 then 14 file + current file
            },
            dateFormat: 'yyyy-MM-dd',
        },
    };
}

function isResolvable(moduleName: string): boolean {
    try {
        require.resolve(moduleName);
        return true;
    } catch {
        return false;
    }
}

function consoleTarget(config: ConfigPort): TransportTargetOptions {
    const pretty = config.get('logging.pretty') ?? config.isDevelopment();
    // pino-pretty is a devDependency: fall back to JSON stdout when it is not installed
    if (pretty && isResolvable('pino-pretty')) {
        return {
            target: 'pino-pretty',
            level: config.get('logging.logLevel'),
            options: { singleLine: true, colorize: true },
        };
    }
    return {
        target: 'pino/file',
        level: config.get('logging.logLevel'),
        options: { destination: 1 }, // stdout
    };
}

export function isHealthCheck(url: string | undefined): boolean {
    return !!url && /^\/health(\/ready)?\/?(\?.*)?$/.test(url);
}

/**
 * pino-http wraps whatever serializer sits at its error key as
 * `(value) => customSerializer(defaultErrSerializer(value))` (pino-std-serializers'
 * `wrapErrorSerializer`, `lib/err.js`) — by the time our serializer runs, `value` is already
 * pino's own flattened `{ type, message, stack, raw: <original error> }`, not the original
 * `Error`. `raw` is the untouched original, so unwrapping it keeps `origin`/`causeOrigin`
 * accurate for that path too, instead of silently falling back to `typeof value`.
 */
function unwrapRaw(value: unknown): unknown {
    if (typeof value === 'object' && value !== null && 'raw' in value) {
        return (value as { raw?: unknown }).raw ?? value;
    }
    return value;
}

/**
 * Replaces pino's default error handling (which serializes the FULL untrimmed stack, ungated)
 * for every `meta.error` passed to the logger — job-runner, the domain event publisher, the
 * connection pool, the Oracle client — not just `GlobalExceptionFilter`. `origin`/`causeOrigin`
 * are always on; the stack is included only when `SHOW_STACK_TRACES=true`, and then trimmed the
 * same way.
 */
function errorSerializer(config: ConfigPort) {
    return (value: unknown) => {
        const source = unwrapRaw(value);
        const error = source instanceof Error ? source : undefined;
        const { origin, causeOrigin } = resolveErrorOrigin(source);
        const showStack = !!config.get('logging.showStackTraces');

        return {
            type: error?.name ?? typeof source,
            message: error?.message ?? String(source),
            origin,
            causeOrigin,
            stack: showStack ? formatStackTrace(error?.stack) : undefined,
        };
    };
}

export const generatePinoOptions = (config: ConfigPort): Params => {
    const requestIdHeader = config.get('logging.requestIdHeader');
    const targets = [fileRotationTarget(config), consoleTarget(config)].filter(
        (target): target is TransportTargetOptions => !!target,
    );
    const serializeError = errorSerializer(config);

    return {
        pinoHttp: {
            level: config.get('logging.logLevel'),
            autoLogging: true,
            transport: { targets },
            genReqId: (req: IncomingMessage) => {
                const header = req.headers[requestIdHeader];
                const candidate = Array.isArray(header) ? header[0] : header;
                // a client-supplied id lands in every log line for this request: keep it bounded
                const requestId = isSafeCorrelationId(candidate) ? candidate : randomUUID();
                req.headers[requestIdHeader] = requestId;
                req.id = requestId;
                return requestId;
            },
            redact: {
                paths: [
                    'req.headers.authorization',
                    'req.headers.cookie',
                    'res.headers["set-cookie"]',
                ],
                remove: true,
            }, // redact sensitive information
            serializers: {
                req: (req: IncomingMessage) => ({
                    method: req.method,
                    url: req.url,
                    id: req.headers[requestIdHeader],
                    ip: req.socket?.remoteAddress,
                    userAgent: req.headers['user-agent'],
                }),
                res: (res: Response) => ({
                    statusCode: res.statusCode,
                }),
                // our own call sites (`logger.error(message, { error })`)
                error: serializeError,
                // pino-http's own automatic access-log line builds its error object under the
                // literal key `err` (pino-http/logger.js: `[errKey]: error`, `errKey` defaults to
                // 'err') — a key this template doesn't control. Same serializer, so that line is
                // trimmed too instead of falling back to pino's default full-stack serializer.
                err: serializeError,
            },
            customProps: (req: IncomingMessage) => ({
                env: config.get('app.env'),
                requestId: req.id,
            }),
            customAttributeKeys: { responseTime: 'latencyMs' },
            base: { hostname: hostname(), pid: process.pid },
            timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
            customSuccessMessage(req, res) {
                return `OK ${req.method} ${req.url} ${res.statusCode}`;
            },
            customErrorMessage(req, res, error) {
                return `ERR ${req.method} ${req.url} ${res.statusCode} - ${error.message}`;
            },
            // 5xx are logged with details by GlobalExceptionFilter; keep one access-log line here.
            // `error` here is pino-http's own request/response error (its 3rd callback argument,
            // e.g. `res.err` set by Express error middleware) — not our `LogMeta.error` field, so
            // there is no second key to read: the two never overlap.
            customLogLevel(req, res, error) {
                if (error || res.statusCode >= 500) return 'error';
                if (res.statusCode >= 400) return 'warn';
                // monitoring tools poll health endpoints; keep successful polls out of the logs
                if (isHealthCheck(req.url)) return 'silent';
                return 'info';
            },
        },
    };
};
