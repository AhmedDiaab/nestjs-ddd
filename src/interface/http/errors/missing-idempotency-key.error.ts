import { BadRequestError } from '@application/errors';
import type { ProblemLike } from '@shared';

/** 400 for a route decorated `@Idempotent()` that was called without its key header. */
export class MissingIdempotencyKeyError extends BadRequestError {
    constructor(header: string) {
        super(`Missing required "${header}" header`);
    }

    override toProblem(): ProblemLike {
        return { ...super.toProblem(), code: 'MISSING_IDEMPOTENCY_KEY' };
    }
}
