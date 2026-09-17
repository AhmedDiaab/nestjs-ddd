import { randomUUID } from 'node:crypto';
import { type IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { ConfigPort } from '@application/ports';
import { isSafeCorrelationId } from '@shared';
import type { Response } from 'express';
import type { Params } from 'nestjs-pino';
import type { TransportTargetOptions } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';

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

export const generatePinoOptions = (config: ConfigPort): Params => {
    const requestIdHeader = config.get('logging.requestIdHeader');
    const targets = [fileRotationTarget(config), consoleTarget(config)].filter(
        (target): target is TransportTargetOptions => !!target,
    );

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
            customErrorMessage(req, res, err) {
                return `ERR ${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
            },
            // 5xx are logged with details by GlobalExceptionFilter; keep one access-log line here
            customLogLevel(req, res, err) {
                if (err || res.statusCode >= 500) return 'error';
                if (res.statusCode >= 400) return 'warn';
                // monitoring tools poll health endpoints; keep successful polls out of the logs
                if (isHealthCheck(req.url)) return 'silent';
                return 'info';
            },
        } as PinoHttpOptions,
    };
};
