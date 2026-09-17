import { ProblemTypes, type ProblemLike } from '@shared';
import { DomainError } from './domain.error';

export class ValidationError extends DomainError {
    constructor(public readonly fieldErrors: Record<string, string>) {
        super('Validation failed', fieldErrors);
    }
    toProblem(): ProblemLike {
        return {
            kind: 'validation',
            type: ProblemTypes.Validation,
            title: 'Validation Error',
            detail: this.message,
            errors: this.fieldErrors,
        };
    }
}
