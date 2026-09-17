import { InfrastructureError } from '@application/errors';
import { ProblemTypes, type ProblemLike } from '@shared';

export class DatabaseConnectionError extends InfrastructureError {
    constructor(
        public readonly sourceKey: string,
        cause?: unknown,
    ) {
        super(`Failed to acquire a DB connection for "${sourceKey}"`, cause);
    }

    toProblem(): ProblemLike {
        return {
            kind: 'service_unavailable',
            type: ProblemTypes.ServiceUnavailable,
            title: 'Database unavailable',
            detail: `Cannot obtain connection for source "${this.sourceKey}". Try again later.`,
        };
    }
}
