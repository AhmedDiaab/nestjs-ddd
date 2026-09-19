import { ProblemTypes, type PresentableError, type ProblemLike } from '@shared';

export abstract class AppError extends Error implements PresentableError {
    readonly isAppError = true as const;

    constructor(
        message: string,
        public readonly details?: unknown,
    ) {
        super(message);
        // V8-only: records this error's own creation site with the constructor frames removed,
        // so `errorOrigin` finds it even after the throw crosses an `await` boundary.
        if (typeof Error.captureStackTrace === 'function') {
            Error.captureStackTrace(this, new.target);
        }
    }

    toProblem(): ProblemLike {
        return {
            kind: 'internal',
            type: ProblemTypes.Internal,
            title: 'Application Error',
            detail: this.message,
        };
    }
}
