/**
 * Raw env → schema input helpers.
 * They return `undefined` for unset/blank values so Zod `.default()` applies.
 */
export function envString(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

export function envBool(value: string | undefined): boolean | undefined {
    const v = envString(value)?.toLowerCase();
    if (v === undefined) return undefined;
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
    // leave invalid input to fail validation instead of silently becoming false
    return value as unknown as boolean;
}

/** Comma-separated list; blank entries dropped. */
export function envList(value: string | undefined): string[] | undefined {
    const v = envString(value);
    if (v === undefined) return undefined;
    return v
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
