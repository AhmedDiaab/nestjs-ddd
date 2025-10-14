import { AppError } from '@application/errors/app-error';
import { DomainError } from '@domain/errors/domain-error';
import { HttpStatus, Injectable } from '@nestjs/common';
import { isPresentableError, ProblemKind, ProblemLike, ProblemTypes } from '@shared/problem';

const KIND_TO_STATUS: Record<ProblemKind, number> = {
    validation: HttpStatus.UNPROCESSABLE_ENTITY, // 422
    not_found: HttpStatus.NOT_FOUND, // 404
    conflict: HttpStatus.CONFLICT, // 409
    unauthorized: HttpStatus.UNAUTHORIZED, // 401
    forbidden: HttpStatus.FORBIDDEN, // 403
    service_unavailable: HttpStatus.SERVICE_UNAVAILABLE, // 503
    bad_request: HttpStatus.BAD_REQUEST, // 400
    internal: HttpStatus.INTERNAL_SERVER_ERROR, // 500
};

@Injectable()
export class ErrorPresenter {
    present(
        error: unknown,
        traceId?: string,
    ): { status: number; body: ProblemLike & { status: number; traceId?: string } } {
        if (isPresentableError(error)) {
            const problem: ProblemLike = error.toProblem();
            const status = KIND_TO_STATUS[problem.kind] ?? HttpStatus.INTERNAL_SERVER_ERROR;
            return { status, body: { ...problem, status, traceId } };
        }

        // Soft fallbacks based on markers
        if ((error as DomainError)?.isDomainError) {
            const status = KIND_TO_STATUS['validation'];
            return {
                status,
                body: {
                    kind: 'validation',
                    type: ProblemTypes.Validation,
                    title: 'Domain Error',
                    detail: (error as DomainError).message ?? 'Domain rule violated',
                    status,
                    traceId,
                },
            };
        }

        if ((error as AppError)?.isAppError) {
            const status = KIND_TO_STATUS['internal'];
            return {
                status,
                body: {
                    kind: 'internal',
                    type: ProblemTypes.Internal,
                    title: 'Application Error',
                    detail: (error as AppError).message ?? 'Application failure',
                    status,
                    traceId,
                },
            };
        }

        const status = KIND_TO_STATUS['internal'];
        return {
            status,
            body: {
                kind: 'internal',
                type: ProblemTypes.Internal,
                title: 'Internal Error',
                detail: 'Unexpected error',
                status,
                traceId,
            },
        };
    }
}
