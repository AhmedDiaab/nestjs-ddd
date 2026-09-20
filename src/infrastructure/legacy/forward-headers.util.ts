import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';

/**
 * Meaningful only between this hop and the one before it; a proxy must not repeat them to the
 * next hop (RFC 7230 §6.1, plus `proxy-authenticate`/`proxy-authorization` for this specific
 * hop's own auth).
 */
const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'transfer-encoding',
    'upgrade',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
]);

/**
 * The same rule applied to the response on its way back: a header meaningful only between this
 * app and the legacy service must not be repeated to the client. Forwarding `connection` or
 * `keep-alive` describes a connection the client never had, and forwarding `transfer-encoding`
 * or `upgrade` describes an encoding this hop is re-deciding for itself.
 */
export function stripHopByHopHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
    const kept: OutgoingHttpHeaders = {};

    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
        kept[name] = value;
    }
    return kept;
}

export type ForwardHeadersInput = {
    /** The inbound request's own headers (Node lower-cases every header name). */
    headers: IncomingHttpHeaders;
    /** `req.socket.remoteAddress`; appended to `X-Forwarded-For`. */
    remoteAddress: string;
    /** The scheme the client used to reach this service. */
    protocol: 'http' | 'https';
    /** The client's original `Host` header, if it sent one. */
    hostHeader: string | undefined;
    /** `host[:port]` of the legacy target, used as `Host` unless `preserveHostHeader` is set. */
    targetHost: string;
    /** Forward the client's original `Host` header instead of the legacy target's. */
    preserveHostHeader: boolean;
    /** The resolved request-id header name and value, always set on the outbound request. */
    requestId: { header: string; value: string };
};

function forwardedForValue(
    existing: IncomingHttpHeaders['x-forwarded-for'],
    remoteAddress: string,
): string {
    if (!existing) return remoteAddress;
    const previous = Array.isArray(existing) ? existing.join(', ') : existing;
    return `${previous}, ${remoteAddress}`;
}

/**
 * Builds the headers sent to the legacy service: hop-by-hop headers dropped, `X-Forwarded-*`
 * set, `Host` decided by `preserveHostHeader`, and everything else — `Authorization`, cookies,
 * the request-id header — passed through unchanged.
 */
export function buildForwardHeaders(input: ForwardHeadersInput): OutgoingHttpHeaders {
    const headers: OutgoingHttpHeaders = {};

    for (const [name, value] of Object.entries(input.headers)) {
        if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
        headers[name] = value;
    }

    headers['x-forwarded-for'] = forwardedForValue(
        input.headers['x-forwarded-for'],
        input.remoteAddress,
    );
    headers['x-forwarded-proto'] = input.protocol;
    headers['x-forwarded-host'] = input.hostHeader ?? '';
    headers.host = input.preserveHostHeader
        ? (input.hostHeader ?? input.targetHost)
        : input.targetHost;
    headers[input.requestId.header] = input.requestId.value;

    return headers;
}
