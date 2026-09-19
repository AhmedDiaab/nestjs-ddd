import { ProblemTypes, type PresentableError, type ProblemLike } from '@shared';

export abstract class DomainError extends Error implements PresentableError {
    readonly isDomainError = true as const;

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

    // Conservative default; subclasses usually override
    toProblem(): ProblemLike {
        return {
            kind: 'validation',
            type: ProblemTypes.Validation,
            title: 'Domain Error',
            detail: this.message,
        };
    }
}
