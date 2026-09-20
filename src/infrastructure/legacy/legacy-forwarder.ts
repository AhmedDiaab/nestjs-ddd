import { randomUUID } from 'node:crypto';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { LoggerPort } from '@application/ports';
import { isSafeCorrelationId } from '@shared';
import type { NextFunction, Request, Response } from 'express';
import { buildForwardHeaders, stripHopByHopHeaders } from './forward-headers.util';
import { matchesLegacyPrefix } from './matches-prefix.util';

export type LegacyForwarderOptions = {
    /** Base URL of the legacy service, e.g. `http://legacy-host:8080`. */
    targetUrl: string;
    /** Path prefixes forwarded as-is; everything else falls through to `next()`. */
    forwardPrefixes: readonly string[];
    /** Per-request timeout to the legacy service. */
    timeoutMs: number;
    /** Forward the client's original Host header instead of the legacy target's. */
    preserveHostHeader: boolean;
    /** Header name carrying the correlation id, e.g. `x-request-id` (`logging.requestIdHeader`). */
    requestIdHeader: string;
    logger: LoggerPort;
};

/**
 * Dumb transport for paths not yet migrated off a legacy service (option B, "New service in
 * front" — `docs/guides/migrate-a-legacy-service.md`). No `@nestjs/*`, no `HttpClient`: only
 * `node:http`/`node:https`, so the request and response bodies stream through unchanged instead
 * of being buffered and re-serialized. Mounted with `app.use()` in `src/main.ts`, before the
 * body parsers, so the raw request stream is still intact when it arrives here — see decision
 * 0013.
 *
 * Runs before `RequestContextMiddleware` (a Nest middleware, wired later in the pipeline), so it
 * resolves its own request id instead of reading one from the request context.
 */
export class LegacyForwarder {
    private readonly target: URL;
    private readonly client: typeof http | typeof https;
    private readonly targetHost: string;

    constructor(private readonly options: LegacyForwarderOptions) {
        this.target = new URL(options.targetUrl);
        this.client = this.target.protocol === 'https:' ? https : http;
        this.targetHost = this.target.port
            ? `${this.target.hostname}:${this.target.port}`
            : this.target.hostname;
    }

    /** Express-compatible middleware: forwards a matched path, calls `next()` otherwise. */
    middleware() {
        return (req: Request, res: Response, next: NextFunction): void => {
            if (!matchesLegacyPrefix(req.path, this.options.forwardPrefixes)) {
                next();
                return;
            }
            this.forward(req, res);
        };
    }

    private forward(req: Request, res: Response): void {
        const headers = buildForwardHeaders({
            headers: req.headers,
            remoteAddress: req.socket.remoteAddress ?? 'unknown',
            protocol: req.protocol === 'https' ? 'https' : 'http',
            hostHeader: req.headers.host,
            targetHost: this.targetHost,
            preserveHostHeader: this.options.preserveHostHeader,
            requestId: { header: this.options.requestIdHeader, value: this.requestIdFor(req) },
        });

        const outbound = this.client.request({
            protocol: this.target.protocol,
            hostname: this.target.hostname,
            port: this.target.port || (this.target.protocol === 'https:' ? 443 : 80),
            method: req.method,
            path: req.originalUrl,
            headers,
            timeout: this.options.timeoutMs,
        });

        let timedOut = false;

        outbound.on('timeout', () => {
            timedOut = true;
            // An explicit error guarantees the 'error' event fires so the response below is
            // always sent; destroy() with no argument does not reliably emit one.
            outbound.destroy(new Error('legacy service timed out'));
        });

        outbound.on('response', (upstream: IncomingMessage) => {
            // The status and body pass through untouched; the hop-by-hop headers do not, since
            // they describe this app's connection to the legacy service, not the client's.
            res.writeHead(upstream.statusCode ?? 502, stripHopByHopHeaders(upstream.headers));
            upstream.pipe(res);
        });

        outbound.on('error', () => {
            const status = timedOut ? 504 : 502;
            this.options.logger.error('legacy.forward.failed', {
                method: req.method,
                path: req.path,
                status,
            });
            if (!res.headersSent) {
                res.writeHead(status, { 'content-type': 'text/plain' });
                res.end(status === 504 ? 'Gateway Timeout' : 'Bad Gateway');
            } else {
                res.destroy();
            }
        });

        // The client disconnecting mid-request must not leave the outbound socket open.
        req.on('aborted', () => outbound.destroy());

        req.pipe(outbound);
    }

    /** A caller may supply the correlation id, but not arbitrary bytes; see `isSafeCorrelationId`. */
    private requestIdFor(req: Request): string {
        const header = req.headers[this.options.requestIdHeader.toLowerCase()];
        const candidate = Array.isArray(header) ? header[0] : header;
        return isSafeCorrelationId(candidate) ? candidate : randomUUID();
    }
}
