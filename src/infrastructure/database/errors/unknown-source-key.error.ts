import { InfrastructureError } from '@application/errors';
import { ProblemTypes, type ProblemLike } from '@shared';

export class UnknownSourceKeyError extends InfrastructureError {
    constructor(
        public readonly sourceKey: string,
        cause?: unknown,
    ) {
        super(`No database source configured for key "${sourceKey}"`, cause);
    }

    toProblem(): ProblemLike {
        return {
            kind: 'service_unavailable',
            type: ProblemTypes.ServiceUnavailable,
            title: 'Unknown data source',
            detail: `The data source key "${this.sourceKey}" is not configured.`,
            // optional: extras: { sourceKey: this.sourceKey }
        };
    }
}
