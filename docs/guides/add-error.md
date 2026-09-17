# Add an error

Errors carry a **problem kind**; the interface layer maps kinds to HTTP status. Domain and application code never mention HTTP.

## Choose the base

| Failure is about…                                                | Extend                | Location                                   |
| ---------------------------------------------------------------- | --------------------- | ------------------------------------------ |
| a business rule of an entity/value object                        | `DomainError`         | `src/domain/<feature>/<feature>.errors.ts` |
| orchestration (not found, not allowed, conflict with other data) | `AppError`            | `src/application/errors/`                  |
| a technical failure in an adapter                                | `InfrastructureError` | `src/infrastructure/<area>/errors/`        |

Reuse before adding: `NotFoundError` (404), `ConflictError` (409), `BadRequestError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `ValidationError` (422 with field map).

## Kinds and statuses

`src/shared/problem.ts` (`ProblemKind`) + `src/interface/http/error-presenter.ts` (`KIND_TO_STATUS`):

| Kind                  | Status |
| --------------------- | ------ |
| `bad_request`         | 400    |
| `unauthorized`        | 401    |
| `forbidden`           | 403    |
| `not_found`           | 404    |
| `conflict`            | 409    |
| `validation`          | 422    |
| `internal`            | 500    |
| `not_implemented`     | 501    |
| `service_unavailable` | 503    |

## Example: application error

```ts
// src/application/errors/ticket-limit-reached.error.ts
import { ProblemTypes, type ProblemLike } from '@shared';
import { AppError } from './app.error';

export class TicketLimitReachedError extends AppError {
    constructor(limit: number) {
        super(`You can have at most ${limit} open tickets`, { limit });
    }

    override toProblem(): ProblemLike {
        return {
            kind: 'conflict',
            type: ProblemTypes.Conflict,
            title: 'Ticket limit reached',
            detail: this.message, // → error.message
            code: 'TICKET_LIMIT_REACHED', // → error.code (stable, for clients)
        };
    }
}
```

Export it from `src/application/errors/index.ts`, then return it from a use case:

```ts
if (openCount >= limit) return this.err(new TicketLimitReachedError(limit));
```

The constructor's second argument (`details`) is for logs only; it's never sent to clients.

## Example: mapping a database application error

PL/SQL `RAISE_APPLICATION_ERROR(-20101, 'user not allowed')` reaches the adapter in two forms:

- **Inside** the `withConnection`/`transaction` callback: the raw driver error (`{ code: 'ORA-20101', errorNum: 20101 }`).
- **Outside** it: already mapped by `OracleClient` to `DatabaseExecutionError` with `code: 'ORA-20101'`.

Translate it outside the callback, where the type is stable:

```ts
import { ForbiddenError } from '@application/errors';
import { DatabaseExecutionError } from '@infrastructure/database/errors';

async deleteSite(name: string, options?: QueryOptions): Promise<void> {
    try {
        await this.db.transaction<void, Connection>(
            DatabaseSources.main,
            async (connection) => {
                await connection.execute(DELETE_SITE, { name });
            },
            { contextUser: options?.actor, tag: 'sites.delete' },
        );
    } catch (error) {
        if (error instanceof DatabaseExecutionError && error.code === 'ORA-20101') {
            throw new ForbiddenError('You are not allowed to delete this site'); // → 403
        }
        throw error;
    }
}
```

Application errors thrown from inside the callback pass through the mapper unchanged, so throwing `ForbiddenError` there works too. You just have to match on the raw `code` instead.

## Adding a new kind (rare)

1. Add it to `ProblemKind` and `ProblemTypes` in `src/shared/problem.ts`.
2. Add the status to `KIND_TO_STATUS` in `src/interface/http/error-presenter.ts` (TypeScript forces this: the record is exhaustive).
3. Add a test in `test/unit/interface/global-exception.filter.spec.ts`.

## Test

- Use case returns the error: `expect(!result.ok && result.error).toBeInstanceOf(TicketLimitReachedError)`.
- HTTP status: e2e `.expect(409)`.
