import { ProblemTypes, type ProblemLike } from '@shared';
import { AppError } from './app.error';

export class ForbiddenError extends AppError {
    constructor(message = 'Forbidden Error', details?: unknown) {
        super(message, details);
    }

    override toProblem(): ProblemLike {
        return {
            kind: 'forbidden',
            type: ProblemTypes.Forbidden,
            title: 'Forbidden',
            detail: this.message,
        };
    }
}
