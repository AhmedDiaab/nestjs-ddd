import { InfrastructureError } from '@application/errors';
import { ProblemTypes, type ProblemLike } from '@shared';

export type DbHealthFailure = {
    sourceKey: string;
    dialect: string;
    message: string;
    attempts: number;
    latencyMs?: number;
};

export class AggregateDbHealthError extends InfrastructureError {
    constructor(public readonly failures: DbHealthFailure[]) {
        super('One or more database sources are unavailable', failures);
    }
    toProblem(): ProblemLike {
        return {
            kind: 'service_unavailable',
            type: ProblemTypes.ServiceUnavailable,
            title: 'Database unavailable',
            detail: 'One or more data sources failed health checks.',
            // optionally include failures in meta if your Problem supports it
            // meta: { failures: this.failures },
        };
    }
}
