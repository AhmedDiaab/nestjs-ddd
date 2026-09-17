import { InfrastructureError } from '@application/errors';
import { ProblemTypes, type ProblemLike } from '@shared';

export class UnsupportedDialectError extends InfrastructureError {
    constructor(
        public readonly sourceKey: string,
        public readonly dialect: string,
        cause?: unknown,
    ) {
        super(`Dialect "${dialect}" for source "${sourceKey}" is not implemented`, cause);
    }

    toProblem(): ProblemLike {
        return {
            kind: 'not_implemented',
            type: ProblemTypes.NotImplemented,
            title: 'Dialect not implemented',
            detail: `Dialect "${this.dialect}" for source "${this.sourceKey}" is not supported yet.`,
        };
    }
}
