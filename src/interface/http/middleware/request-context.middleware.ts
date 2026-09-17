import { randomUUID } from 'node:crypto';
import {
    ConfigPortToken,
    RequestContextPortToken,
    type ConfigPort,
    type RequestContextPort,
} from '@application/ports';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Opens the request context so anything downstream — the HTTP client above all — can read the
 * correlation id without it being threaded through every signature.
 *
 * Runs as middleware, before guards, so a rejected request is still traceable.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
    constructor(
        @Inject(RequestContextPortToken) private readonly context: RequestContextPort,
        @Inject(ConfigPortToken) private readonly config: ConfigPort,
    ) {}

    use(req: Request, _res: Response, next: NextFunction): void {
        const headerName = this.config.get('logging.requestIdHeader');
        const header = req.headers[headerName];
        const fromHeader = Array.isArray(header) ? header[0] : header;
        const requestId = typeof req.id === 'string' ? req.id : (fromHeader ?? randomUUID());

        this.context.run({ requestId }, () => next());
    }
}
