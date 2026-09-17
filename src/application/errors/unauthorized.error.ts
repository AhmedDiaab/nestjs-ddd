import { ProblemTypes, type ProblemLike } from '@shared';
import { AppError } from './app.error';

export class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized Error', details?: unknown) {
        super(message, details);
    }

    override toProblem(): ProblemLike {
        return {
            kind: 'unauthorized',
            type: ProblemTypes.Unauthorized,
            title: 'Unauthorized',
            detail: this.message,
        };
    }
}
