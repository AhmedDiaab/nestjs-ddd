export type Meta = {
    timestamp: string;
    path: string;
    requestId?: string | null;
    [k: string]: unknown;
};

export type ErrorBody = {
    message: string;
    code?: string;
    details?: unknown;
};

export type SuccessEnvelope<T> = {
    success: true;
    data: T;
    meta: Meta;
};

export type ErrorEnvelope = {
    success: false;
    error: ErrorBody;
    meta: Meta;
};

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export type Paginated<TItem> = {
    items: TItem[];
    total: number;
    page?: number;
    limit?: number;
    nextCursor?: string | null;
};

export const SKIP_FORMAT_HEADER = 'x-skip-format';
