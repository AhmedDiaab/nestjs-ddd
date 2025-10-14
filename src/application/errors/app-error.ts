import { ProblemTypes, type PresentableError, type ProblemLike } from '@shared/problem';

export abstract class AppError extends Error implements PresentableError {
    readonly isAppError = true as const;

    constructor(
        message: string,
        public readonly details?: unknown,
    ) {
        super(message);
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
