import { ProblemTypes, type ProblemLike } from '@shared';
import { AppError } from './app.error';

export class InfrastructureError extends AppError {
    constructor(
        message = 'Infrastructure failure',
        public readonly cause?: unknown,
    ) {
        super(message, cause);
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
