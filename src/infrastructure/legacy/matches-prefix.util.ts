/** Strips one trailing slash so `/v1/orders` and `/v1/orders/` compare equal. Keeps a bare `/`. */
function normalize(path: string): string {
    return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Does `path` fall under one of the configured legacy prefixes? A prefix matches itself
 * (`/v1/orders` ~ `/v1/orders`) and its sub-paths (`/v1/orders/1`), but never a path that only
 * shares characters with it (`/v1/orders-archive` does NOT match `/v1/orders`) — the boundary
 * has to land on a path segment, not partway through a word.
 */
export function matchesLegacyPrefix(path: string, prefixes: readonly string[]): boolean {
    const target = normalize(path);

    return prefixes.some((prefix) => {
        const normalizedPrefix = normalize(prefix);
        return target === normalizedPrefix || target.startsWith(`${normalizedPrefix}/`);
    });
}
