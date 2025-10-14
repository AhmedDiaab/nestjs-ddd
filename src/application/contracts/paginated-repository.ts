import type { CursorRequest, OffsetRequest, PageEnvelope } from '@shared/pagination/types';

export interface OffsetRepositoryPort<T, Filter = unknown> {
    findManyOffset(filter: Filter, req: OffsetRequest): Promise<PageEnvelope<T>>;
}

export interface CursorRepositoryPort<T, Filter = unknown> {
    findManyCursor(filter: Filter, req: CursorRequest): Promise<PageEnvelope<T>>;
}
