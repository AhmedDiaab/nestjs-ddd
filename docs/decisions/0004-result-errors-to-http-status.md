# 0004. Expected failures are Result values mapped to HTTP status

- Status: Accepted
- Date: 2026-09-17

## Context

Use cases returned `Result.err(...)`, but the response formatter wrapped it into HTTP **200** with `success: false`, so clients and monitoring saw failures as successes.

## Decision

- Expected failures are returned as `Result.err(error)`, where `error` is an `AppError` or `DomainError` whose `toProblem()` declares a problem **kind**.
- `ResponseFormatterInterceptor` rethrows such errors; `GlobalExceptionFilter` + `ErrorPresenter` map the kind to a status (validation 422, not_found 404, conflict 409, …).
- Non-error values in `Result.err` become 422 with `error.code`.
- Unexpected failures are thrown.
- Domain/application code never references HTTP.

## Consequences

- Failure types are visible in use-case signatures (`UseCase<I, O, Failure>`).
- Correct statuses without HTTP concerns in the core.
- Internal `details` never reach clients; only `detail`, `code`, `type` and validation field errors do.
