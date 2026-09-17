import { createToken } from '@shared';

/** What every layer may know about the request being handled, without touching HTTP types. */
export type RequestContext = {
    /** Correlation id of the incoming request; propagated to services this one calls. */
    requestId?: string;
    /** W3C trace id: the same value across every service handling this request. */
    traceId?: string;
    /** This service's span in that trace. */
    spanId?: string;
    /** The caller's sampling decision, passed on unchanged. */
    sampled?: boolean;
};

export interface RequestContextPort {
    /** Runs `fn` with this context attached to everything it awaits. */
    run<T>(context: RequestContext, fn: () => T): T;
    /** The current context, or `undefined` outside a request (boot, cron jobs). */
    get(): RequestContext | undefined;
}

export const RequestContextPortToken = createToken<RequestContextPort>('RequestContextPort');
