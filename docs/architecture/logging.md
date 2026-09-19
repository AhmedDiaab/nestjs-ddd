# Logging

`src/infrastructure/logging`: [nestjs-pino](https://github.com/iamolegga/nestjs-pino) with structured JSON.

## Using the logger

Inject the port, never pino directly:

```ts
constructor(@Inject(LoggerPortToken) private readonly logger: LoggerPort) {}

this.logger.warn('db.rollback.failed', { sourceKey: 'main', tag: 'tickets.save', error });
```

- **Messages:** short dotted event names (`db.pool.created`, `ticket.close.rejected`); put details in the meta object. Field names are typed in `src/application/shared/logging.ts` (`LogMeta`: `correlationId`, `useCase`, `aggregate`, `aggregateId`, `http`, `integration`, `error`, …).
- **Never log** secrets, tokens, passwords, bind values, or personal data you don't need (e.g. email addresses).
- **Request context:** `PinoLoggerAdapter` is a singleton, but nestjs-pino resolves the request-bound logger through `AsyncLocalStorage` on every call, so logs written during a request carry its `requestId` automatically.

## What gets logged automatically

| Event                                          | Level                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Every HTTP request (pino-http access log)      | `info`; `warn` for 4xx; `error` for 5xx                                                     |
| Successful `/health` and `/health/ready` polls | not logged (monitoring noise)                                                               |
| Exceptions handled by `GlobalExceptionFilter`  | `warn` 4xx, `error` 5xx, with cause and origin; trimmed stack when `SHOW_STACK_TRACES=true` |
| Pool created/closed, boot pings                | `info` / `warn` / `error`                                                                   |
| Slow queries (`slowQueryMs`)                   | `warn` `db.query.slow`                                                                      |
| Context clear failure (connection dropped)     | `warn` `db.context.clear.failed`                                                            |

Request logs include method, URL, request id, client IP, user agent, status and `latencyMs`. The `authorization`, `cookie` and `set-cookie` headers are removed.

## The `error` field: origin instead of a stack trace

Any `meta.error` value — an `Error`, or anything else thrown — goes through a pino serializer (`src/infrastructure/logging/pino.options.ts`) that replaces pino's default handling (which serializes the FULL, untrimmed stack, unconditionally) with:

```json
{
    "type": "DatabaseExecutionError",
    "message": "DB execution failed for \"main\" (tickets.findById)",
    "origin": "src/infrastructure/database/dao/oracle-tickets.dao.ts:80 (OracleTicketsDao.findById)",
    "causeOrigin": "src/infrastructure/database/dao/oracle-tickets.dao.ts:77 (OracleTicketsDao.findById)"
}
```

- **`origin`** is the one frame of OUR code (never `node_modules`, never a `node:` internal) that created the error — computed by `errorOrigin`/`resolveErrorOrigin` (`src/common/utils/error-origin.util.ts`), which scans the whole stack top-down instead of trusting the top frame, since a driver/library error's top frames are almost always dependency frames.
- **`causeOrigin`** appears only when the error's `cause` chain (`DatabaseExecutionError`, `InfrastructureError`, `UnexpectedError`, …) has a _different_ app frame than `origin` — e.g. the DAO line that wrapped a driver error, vs. the line inside the driver call that actually failed.
- Both are **always on**, independent of `SHOW_STACK_TRACES` — they never carry more than a file, line and function name, so they are safe to leave on in production. The full `stack` stays behind `SHOW_STACK_TRACES=true` and is only ever written to logs, never returned to a client.
- `AppError`/`DomainError` call `Error.captureStackTrace(this, new.target)` in their base constructors, so an error's own creation site is captured with the constructor frames removed — this is what keeps `origin` pointing at the real call site even after the error crosses an `await` boundary.
- This one serializer covers every call site that logs `{ error }` (job-runner, the domain event publisher, the connection pool, the Oracle client, `GlobalExceptionFilter`), plus pino-http's own automatic access-log line, which builds its error object under the literal key `err` (a key this template does not control) — the same serializer is registered there too.
- **`--enable-source-maps`** (passed to `node` in the Dockerfile, `start:prod` and `start-service.ps1`) is what makes `origin`/`causeOrigin` name the `.ts` file and line in a production build, instead of the compiled `.js` line under `dist/`.

See [decision 0010](../decisions/0010-error-origin.md) for why this is one frame and not a stack, and why it stays on.

## Outputs

| Output                                                                              | When                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `logs/app.log` (pino-roll: daily + `LOGGING_MAX_SIZE`, keeps `LOGGING_FILES_LIMIT`) | `LOGGING_TO_FILE=true` (default)                                   |
| stdout, pretty                                                                      | `LOGGING_PRETTY=true`, or development, and `pino-pretty` installed |
| stdout, JSON                                                                        | otherwise                                                          |

Transport targets run in worker threads, so logging doesn't block requests.

Configuration: [Configuration → Logging](configuration.md#logging).
