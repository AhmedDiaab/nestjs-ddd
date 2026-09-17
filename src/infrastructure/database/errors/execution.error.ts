import { InfrastructureError } from '@application/errors';
import { ProblemTypes, type ProblemLike } from '@shared';

export class DatabaseExecutionError extends InfrastructureError {
    constructor(
        public readonly sourceKey: string,
        public readonly sqlTag?: string, // label for observability, never SQL text
        cause?: unknown,
        /** Driver error code, e.g. ORA-20101. Logged, not returned to clients. */
        public readonly code?: string,
    ) {
        super(
            `DB execution failed for "${sourceKey}"${sqlTag ? ` (${sqlTag})` : ''}${code ? ` [${code}]` : ''}`,
            cause,
        );
    }

    toProblem(): ProblemLike {
        return {
            kind: 'internal',
            type: ProblemTypes.Internal,
            title: 'Database error',
            detail: 'A database error occurred.',
        };
    }
}
