// shared/pagination/types.ts
export type PageSize = number & { readonly brand: unique symbol };

export interface PageMeta {
    hasNext: boolean;
    hasPrev?: boolean; // optional if you don’t support "prev"
}

export interface PageEnvelope<T> {
    data: T[];
    meta: PageMeta;
    links?: {
        next?: string; // opaque cursor token
        prev?: string; // opaque cursor token
    };
}

export interface OffsetRequest {
    page: number; // 1-based
    size: PageSize; // validated cap server-side
    orderBy?: string; // e.g., "createdAt:desc"
}

export interface CursorRequest {
    size: PageSize;
    after?: string; // opaque token
    before?: string; // optional if you support reverse
    orderBy?: string; // keep deterministic: e.g., "createdAt:desc,id:desc"
}
