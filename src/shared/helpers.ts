import type { Result } from './result';
import type { Rec } from './type-utils';

export function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isEnvelope(
    v: unknown,
): v is { success: boolean; meta: Rec; data?: unknown; error?: Rec } {
    return (
        isRecord(v) &&
        'success' in v &&
        typeof v.success === 'boolean' &&
        'meta' in v &&
        isRecord(v.meta)
    );
}

export function isResultLike(v: unknown): v is Result<unknown, unknown> {
    if (!isRecord(v) || !('ok' in v)) return false;
    const ok = v.ok;
    if (ok === true) return 'value' in v;
    if (ok === false) return 'error' in v;
    return false;
}
