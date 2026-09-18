import { AppError } from '@application/errors';
import { ProblemTypes, type ProblemLike } from '@shared';

/**
 * 422 for an `@Idempotent()` key reused with a different request body. Not a `ConflictError`:
 * the key isn't busy, the caller is misusing it, which is a validation problem — the body it
 * sent does not match the one that first claimed this key.
 */
export class IdempotencyKeyReusedError extends AppError {
    constructor() {
        super('This Idempotency-Key was already used with a different request body');
    }

    override toProblem(): ProblemLike {
        return {
            kind: 'validation',
            type: ProblemTypes.Validation,
            title: 'Idempotency key reused',
            detail: this.message,
            code: 'IDEMPOTENCY_KEY_REUSED',
        };
    }
}
