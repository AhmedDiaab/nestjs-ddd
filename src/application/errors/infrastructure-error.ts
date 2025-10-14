import { ProblemTypes, type ProblemLike } from '@shared/problem';
import { AppError } from './app-error';

export class InfrastructureError extends AppError {
    constructor(public readonly cause: unknown) {
        super('Infrastructure failure', cause);
    }
    toProblem(): ProblemLike {
        return {
            kind: 'service_unavailable',
            type: ProblemTypes.ServiceUnavailable,
            title: 'Service Unavailable',
            detail: 'Try again later',
        };
    }
}
