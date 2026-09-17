export function toString(term: unknown): string | null {
    return term === null || term === undefined ? null : String(term as string);
}
