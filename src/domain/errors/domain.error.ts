import { ProblemTypes, type PresentableError, type ProblemLike } from '@shared';

export abstract class DomainError extends Error implements PresentableError {
    readonly isDomainError = true as const;

    constructor(
        message: string,
        public readonly details?: unknown,
    ) {
        super(message);
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
