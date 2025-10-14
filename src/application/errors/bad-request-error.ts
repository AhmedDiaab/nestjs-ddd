import { ProblemTypes, type ProblemLike } from '@shared/problem';
import { AppError } from './app-error';

export class BadRequestError extends AppError {
    constructor(m = 'Bad Request') {
        super(m);
    }
    toProblem(): ProblemLike {
        return {
            kind: 'bad_request',
            type: ProblemTypes.BadRequest,
            title: 'Bad Request',
            detail: this.message,
        };
    }
}
