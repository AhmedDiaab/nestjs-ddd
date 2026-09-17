import { randomUUID } from 'node:crypto';
import {
    ConfigPortToken,
    RequestContextPortToken,
    type ConfigPort,
    type RequestContextPort,
} from '@application/ports';
import { formatTraceparent, traceContextFrom } from '@infrastructure/context';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { isSafeCorrelationId } from '@shared';
import type { NextFunction, Request, Response } from 'express';

/**
 * Opens the request context so anything downstream — the HTTP client above all — can read the
 * correlation id and the trace without it being threaded through every signature.
 *
 * Runs as middleware, before guards, so a rejected request is still traceable.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
    constructor(
        @Inject(RequestContextPortToken) private readonly context: RequestContextPort,
        @Inject(ConfigPortToken) private readonly config: ConfigPort,
    ) {}

    use(req: Request, res: Response, next: NextFunction): void {
        const headerName = this.config.get('logging.requestIdHeader');
        const requestId = this.requestIdFor(req, headerName);
        const trace = traceContextFrom(req.get('traceparent'));

        // the request id in the body's meta is the one the caller can quote back to us
        req.headers[headerName] = requestId;
        req.id = requestId;

        res.setHeader(headerName, requestId);
        res.setHeader('traceparent', formatTraceparent(trace));

        this.context.run({ requestId, ...trace }, () => next());
    }

    /**
     * A caller may supply the correlation id, but not arbitrary bytes: an unbounded header
     * would end up in every log line for that request, newlines and all.
     */
    private requestIdFor(req: Request, headerName: string): string {
        const header = req.headers[headerName];
        const candidate = Array.isArray(header) ? header[0] : header;

        if (typeof req.id === 'string' && isSafeCorrelationId(req.id)) return req.id;
        if (isSafeCorrelationId(candidate)) return candidate;

        return randomUUID();
    }
}
