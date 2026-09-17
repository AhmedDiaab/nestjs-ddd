import { randomUUID } from 'node:crypto';
import { type IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { ConfigPort } from '@application/ports';
import type { Request, Response } from 'express';
import type { Params } from 'nestjs-pino';
import type { TransportTargetOptions } from 'pino';
import type { Options as PinoHttpOptions } from 'pino-http';

function fileRotationTarget(config: ConfigPort): TransportTargetOptions | undefined {
    if (!config.get<boolean>('logging.toFile')) return undefined;

    const logDirectory = config.get<string>('logging.directory')!;
    const logFileName = config.get<string>('logging.fileName')!;
    const logFilesLimit = config.get<number>('logging.filesLimit')!;
    const maxSize = config.get<string>('logging.maxSize');

    return {
        target: 'pino-roll',
        level: config.get<string>('logging.logLevel'),
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
    const pretty = config.get<boolean>('logging.pretty') ?? config.isDevelopment();
    // pino-pretty is a devDependency: fall back to JSON stdout when it is not installed
    if (pretty && isResolvable('pino-pretty')) {
        return {
            target: 'pino-pretty',
            level: config.get<string>('logging.logLevel'),
            options: { singleLine: true, colorize: true },
        };
    }
    return {
        target: 'pino/file',
        level: config.get<string>('logging.logLevel'),
        options: { destination: 1 }, // stdout
    };
}

export const generatePinoOptions = (config: ConfigPort): Params => {
    const requestIdHeader = config.get<string>('logging.requestIdHeader')!;
    const targets = [fileRotationTarget(config), consoleTarget(config)].filter(
        (target): target is TransportTargetOptions => !!target,
    );

    return {
        pinoHttp: {
            level: config.get<string>('logging.logLevel'),
            autoLogging: true,
            transport: { targets },
            genReqId: (req: Request) => {
                const requestId = req.header(requestIdHeader) || randomUUID();
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
            customProps: (req: Request) => ({
                env: config.get<string>('app.env'),
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
            customLogLevel(_req, res, err) {
                if (err || res.statusCode >= 500) return 'error';
                if (res.statusCode >= 400) return 'warn';
                return 'info';
            },
        } as PinoHttpOptions,
    };
};
