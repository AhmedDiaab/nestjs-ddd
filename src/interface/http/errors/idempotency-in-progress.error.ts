import { ConflictError } from '@application/errors';
import type { ProblemLike } from '@shared';

/** 409 for an `@Idempotent()` key whose first request is still being handled. */
export class IdempotencyInProgressError extends ConflictError {
    constructor() {
        super('A request with this Idempotency-Key is still in progress');
    }

    override toProblem(): ProblemLike {
        return { ...super.toProblem(), code: 'IDEMPOTENCY_IN_PROGRESS' };
    }
}
