export interface PageMeta {
    hasNext: boolean;
    hasPrev?: boolean; // optional if you don't support "prev"
}

export interface PageEnvelope<T> {
    data: T[];
    meta: PageMeta;
    links?: {
        next?: string; // opaque cursor token
        prev?: string; // opaque cursor token
    };
}

/**
 * Offset paging request passed from use cases to query ports.
 * `Sort` is the whitelist of sort keys the port supports, e.g. `'createdAt:desc' | 'title:asc'`;
 * the HTTP schema validates and caps `size` before it gets here.
 */
export interface OffsetRequest<Sort extends string = string> {
    page: number; // 1-based
    size: number;
    orderBy: Sort;
}

/** Keyset (cursor) paging request; keep `orderBy` deterministic, e.g. `'createdAt:desc,id:desc'`. */
export interface CursorRequest<Sort extends string = string> {
    size: number;
    after?: string; // opaque token
    before?: string; // optional if you support reverse
    orderBy: Sort;
}
