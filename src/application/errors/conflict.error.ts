import { ProblemTypes, type ProblemLike } from '@shared';
import { AppError } from './app.error';

export class ConflictError extends AppError {
    constructor(message = 'Conflict', details?: unknown) {
        super(message, details);
    }

    override toProblem(): ProblemLike {
        return {
            kind: 'conflict',
            type: ProblemTypes.Conflict,
            title: 'Conflict',
            detail: this.message,
        };
    }
}
