import { randomBytes } from 'node:crypto';

/** W3C Trace Context: `version-traceid-spanid-flags`, all lower-case hex. */
const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const INVALID_TRACE_ID = '0'.repeat(32);
const INVALID_SPAN_ID = '0'.repeat(16);

export type TraceContext = {
    traceId: string;
    spanId: string;
    /** The upstream's sampling decision, passed on unchanged. */
    sampled: boolean;
};

export const newTraceId = (): string => randomBytes(16).toString('hex');
export const newSpanId = (): string => randomBytes(8).toString('hex');

/**
 * Reads an incoming `traceparent`. Anything malformed is ignored rather than trusted:
 * a header from outside must not be able to put arbitrary text in logs.
 */
export function parseTraceparent(header: string | undefined): TraceContext | undefined {
    const match = TRACEPARENT.exec(header?.trim().toLowerCase() ?? '');
    if (!match) return undefined;

    const [, version, traceId, spanId, flags] = match;
    if (version === 'ff' || traceId === INVALID_TRACE_ID || spanId === INVALID_SPAN_ID) {
        return undefined;
    }

    return { traceId, spanId, sampled: (parseInt(flags, 16) & 1) === 1 };
}

/** Builds the header for an outgoing call; `spanId` identifies this service's side of it. */
export function formatTraceparent({ traceId, spanId, sampled }: TraceContext): string {
    return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

/** Continues the caller's trace when it sent a valid one, otherwise starts a new trace. */
export function traceContextFrom(header: string | undefined): TraceContext {
    const parent = parseTraceparent(header);

    return parent
        ? { traceId: parent.traceId, spanId: newSpanId(), sampled: parent.sampled }
        : { traceId: newTraceId(), spanId: newSpanId(), sampled: true };
}
