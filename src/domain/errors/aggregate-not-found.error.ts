import { ProblemTypes, type ProblemLike } from '@shared';
import { DomainError } from './domain.error';

export class AggregateNotFoundError extends DomainError {
    constructor(
        public readonly aggregate: string,
        public readonly id: string,
    ) {
        super(`${aggregate}(${id}) not found`);
    }

    toProblem(): ProblemLike {
        return {
            kind: 'not_found',
            type: ProblemTypes.NotFound,
            title: 'Not Found',
            detail: this.message,
        };
    }
}
