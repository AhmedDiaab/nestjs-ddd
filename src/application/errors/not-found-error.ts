import { ProblemTypes, type ProblemLike } from '@shared/problem';
import { AppError } from './app-error';

export class NotFoundError extends AppError {
    constructor(message = 'Resource not found', details?: unknown) {
        super(message, details);
    }

    override toProblem(): ProblemLike {
        return {
            kind: 'not_found',
            type: ProblemTypes.NotFound,
            title: 'Not Found',
            detail: this.message,
        };
    }
}
