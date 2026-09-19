type Stringifiable = string | number | boolean | bigint | Date;

/** Only accepts values with a meaningful `toString()`; an arbitrary object would stringify to `"[object Object]"`. */
export function toString(term: Stringifiable | null | undefined): string | null {
    return term === null || term === undefined ? null : String(term);
}
