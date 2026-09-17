import { ForbiddenError } from '@application/errors';
import type { ProblemLike } from '@shared';

/** 403 for a cookie-authenticated write from an untrusted origin (see CsrfGuard). */
export class CsrfRejectedError extends ForbiddenError {
    constructor() {
        super('Cross-site request rejected');
    }

    override toProblem(): ProblemLike {
        return { ...super.toProblem(), code: 'CSRF_REJECTED' };
    }
}
