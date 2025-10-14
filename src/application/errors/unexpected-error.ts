import { ProblemTypes, type ProblemLike } from '@shared/problem';
import { AppError } from './app-error';

export class UnexpectedError extends AppError {
    constructor(public readonly cause: unknown) {
        super('Unexpected failure', cause);
    }
    toProblem(): ProblemLike {
        return {
            kind: 'internal',
            type: ProblemTypes.Internal,
            title: 'Internal Error',
            detail: this.message,
        };
    }
}
