import { randomUUID } from 'node:crypto';
import { type IncomingMessage } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { ConfigPort } from '@application/ports/config.port';
import type { Request, Response } from 'express';
import type { Options as PinoHttpOptions } from 'pino-http';

function generateFileRotationTransport(config: ConfigPort) {
    const logToFile = config.get<boolean>('logging.toFile')!;

    if (!logToFile) return {};

    const logDirectory = config.get<string>('logging.directory')!.toLowerCase();
    const logFileName = config.get<string>('logging.fileName')!.toLowerCase();
    const logFilesLimit = config.get<number>('logging.filesLimit')!;
    const maxSizeInMegaBytes = config.get<number>('logging.maxSize');

    return {
        target: 'pino-roll',
        options: {
            file: join(logDirectory, logFileName),
            frequency: 'daily',
            mkdir: true,
            size: maxSizeInMegaBytes,
            gzip: true,
            limit: {
                count: logFilesLimit + 1, // mean if 14 then 14 file + current file
            },
            dateFormat: 'yyyy-MM-dd',
        },
    };
}

function generateConsolePrettyLogs(config: ConfigPort) {
    if (!config.isDevelopment()) return {};

    return {
        target: 'pino-pretty',
        options: { singleLine: true, colorize: true },
    };
}

function showError(error: Error, config: ConfigPort) {
    if (!config.get('logging.showStackTraces')) return; // TODO: pretify error stack
    return { stack: error.stack, message: error.message };
}

export const generatePinoOptions = (config: ConfigPort) => {
    return {
        pinoHttp: {
            level: config.get<string>('logging.logLevel'),
            autoLogging: true,
            transport: {
                targets: [generateFileRotationTransport(config), generateConsolePrettyLogs(config)],
            },
            genReqId: (req: Request) => {
                const requestIdHeader = config.get<string>('logging.requestIdHeader')!;
                const requestId = req.header(requestIdHeader) || randomUUID();
                req.headers[requestIdHeader] = requestId;
                req.id = requestId;
                return requestId;
            },
            redact: {
                paths: [
                    'req.headers.authorization',
                    'req.headers.cookie',
                    'res.headers.set-cookie',
                ],
                remove: true,
            }, // redact sensitive information
            serializers: {
                req: (req: IncomingMessage) => ({
                    method: req.method,
                    url: req.url,
                    id: req.headers[config.get('logging.requestIdHeader')!],
                    ip: req.socket?.remoteAddress, // TODO: test this later
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
            customAttributeKeys: { responseTime: 'latencyMs', hostname: hostname() },
            timestamp: () => `, "timestamp": "${new Date(Date.now()).toISOString()}"`,
            customSuccessMessage(req, res) {
                return `OK ${req.method} ${req.url} ${res.statusCode}`;
            },
            customErrorMessage(req, res, err) {
                return `ERR ${req.method} ${req.url} ${res.statusCode} - ${err.message} ${showError(err, config)?.stack ? `- ${showError(err, config)?.stack}` : ''}`;
            },
            customLogLevel(req, res, err) {
                if (err || res.statusCode >= 500) return 'silent';
                if (res.statusCode >= 400) return 'warn';
                return 'info';
            },
        } as PinoHttpOptions,
    };
};
