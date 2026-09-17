# Application layer

`src/application`: orchestrates the domain through ports. No infrastructure, no HTTP, no drivers (ESLint enforces this).

## Use cases

One class per use case, extending `UseCase<Input, Output, Failure>` (`src/common/base/use-case.base.ts`):

```ts
@Injectable()
export class CloseTicketUseCase extends UseCase<
    Input,
    Output,
    NotFoundError | TicketAlreadyClosedError
> {
    constructor(@Inject(TicketRepositoryToken) private readonly tickets: TicketRepository) {
        super();
    }

    async execute(input: Input) {
        const ticket = await this.tickets.findById(input.id, { actor: input.username });
        if (!ticket) return this.err(new NotFoundError(`Ticket ${input.id} not found`));

        const closed = ticket.close(input.username, new Date());
        if (!closed.ok) return this.err(closed.error);

        await this.tickets.save(ticket, { actor: input.username });
        return this.ok({ id: ticket.id, status: 'closed' as const });
    }
}
```

Register every use case in `ApplicationModule` (`providers` and `exports`).

## `Result` convention

`src/shared/result.ts`: `Result<T, E> = { ok: true, value } | { ok: false, error }`.

| Situation                               | Do                                                       | HTTP outcome                                    |
| --------------------------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| Success                                 | `return this.ok(value)`                                  | 200/201, `{ success: true, data: value, meta }` |
| Expected business failure               | `return this.err(new SomeAppError())` or a `DomainError` | status from the error's problem kind            |
| Expected failure without an error class | `return this.err('some_code')`                           | 422, `error.code = 'some_code'`                 |
| Unexpected failure (bug, DB down)       | `throw` / let it propagate                               | 500/503 via the exception filter                |

Declare the failure union in the type parameters so callers and tests see what can happen.

## Ports

| File                                        | Port                                                                                | Implemented by         |
| ------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------- |
| `ports/config.port.ts`                      | `ConfigPort`: typed `get('dot.path')`, `isDevelopment()`, `isProduction()`, `all()` | `EnvConfigAdapter`     |
| `ports/logger.port.ts`                      | `LoggerPort`: `debug/info/warn/error(message, meta)`                                | `PinoLoggerAdapter`    |
| `ports/queries/database-info.query.port.ts` | example query port + token                                                          | `DatabaseInfoQueryDao` |
| `ports/queries/query-options.ts`            | `QueryOptions` (`{ actor }`) shared by query ports                                  | n/a                    |
| `ports/queries/*`                           | read models for responses (added per feature)                                       | query DAOs             |
| `ports/tokens.ts`                           | tokens for the cross-cutting ports                                                  | n/a                    |

Read-model types (e.g. `TicketSummary`) are plain serialisable objects: ISO date strings, no class instances.

## Application errors (`src/application/errors`)

All extend `AppError` and implement `toProblem()`:

| Error                 | Problem kind          | HTTP |
| --------------------- | --------------------- | ---- |
| `BadRequestError`     | `bad_request`         | 400  |
| `UnauthorizedError`   | `unauthorized`        | 401  |
| `ForbiddenError`      | `forbidden`           | 403  |
| `NotFoundError`       | `not_found`           | 404  |
| `ConflictError`       | `conflict`            | 409  |
| `InfrastructureError` | `service_unavailable` | 503  |
| `UnexpectedError`     | `internal`            | 500  |

The client receives `detail` as `error.message`, never `details` (those are for logs), except domain `ValidationError` field errors.

## Contracts

Paging has one set of types, in `shared/pagination`: `OffsetRequest<Sort>` and `CursorRequest<Sort>` (requests; `Sort` is the port's whitelist of sort keys), `PageEnvelope<T>` (`{ data, meta: { hasNext, hasPrev }, links }`) and cursor helpers. `contracts/paginated-repository.ts` has generic offset/cursor port shapes built on them. HTTP query schemas (`OffsetQuerySchema`, `CursorQuerySchema`) validate and cap `size` before it reaches a use case.

## Related

- [Add a use case](../guides/add-use-case.md)
- [Decision 0004: Result errors map to HTTP status](../decisions/0004-result-errors-to-http-status.md)
