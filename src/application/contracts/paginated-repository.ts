import type { CursorRequest, OffsetRequest, PageEnvelope } from '@shared/pagination';

export interface OffsetRepositoryPort<T, Filter = unknown, Sort extends string = string> {
    findManyOffset(filter: Filter, req: OffsetRequest<Sort>): Promise<PageEnvelope<T>>;
}

export interface CursorRepositoryPort<T, Filter = unknown, Sort extends string = string> {
    findManyCursor(filter: Filter, req: CursorRequest<Sort>): Promise<PageEnvelope<T>>;
}
