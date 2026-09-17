import { APP_NAME as appName } from './app.constants';

// Semantic kinds only (no HTTP here)
export type ProblemKind =
    | 'validation'
    | 'not_found'
    | 'conflict'
    | 'unauthorized'
    | 'forbidden'
    | 'service_unavailable'
    | 'bad_request'
    | 'internal'
    | 'not_implemented';

// Minimal problem shape that core can emit
export type ProblemLike = {
    kind: ProblemKind;
    type: string; // stable URL/URN identifier
    title: string; // short human title
    detail?: string; // human-readable detail
    // extension members (edge can enrich with traceId/instance)
    errors?: Record<string, string>;
    code?: string;
};

// type guard for ProblemLike
export function isProblemLike(obj: unknown): obj is ProblemLike {
    if (typeof obj !== 'object' || obj === null) return false;
    const o = obj as Record<string, unknown>;
    return (
        typeof o.kind === 'string' &&
        typeof o.type === 'string' &&
        typeof o.title === 'string' &&
        (o.detail === undefined || typeof o.detail === 'string')
    );
}

/**
 * Type guard to check if an unknown object implements `PresentableError`.
 */
export function isPresentableError(obj: unknown): obj is PresentableError {
    if (typeof obj !== 'object' || obj === null) return false;

    // Extract the method safely
    const maybeFn = (obj as Record<string, unknown>).toProblem;
    if (typeof maybeFn !== 'function') return false;
    try {
        // Optionally validate that calling `toProblem()` returns a proper ProblemLike
        const result: unknown = maybeFn.call(obj);
        return isProblemLike(result);
    } catch {
        // Defensive: if toProblem() throws, it's not presentable
        return false;
    }
}

// Interface for errors that can be presented as ProblemLike

export interface PresentableError {
    toProblem(): ProblemLike;
}

// Centralized type URLs (pure strings; safe for core)
export const ProblemTypes = {
    Validation: `urn:${appName}:problem:validation`,
    NotFound: `urn:${appName}:problem:not-found`,
    Conflict: `urn:${appName}:problem:conflict`,
    Unauthorized: `urn:${appName}:problem:unauthorized`,
    Forbidden: `urn:${appName}:problem:forbidden`,
    ServiceUnavailable: `urn:${appName}:problem:service-unavailable`,
    BadRequest: `urn:${appName}:problem:bad-request`,
    Internal: `urn:${appName}:problem:internal`,
    NotImplemented: `urn:${appName}:problem:not-implemented`,
} as const;
