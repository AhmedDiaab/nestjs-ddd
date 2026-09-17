# Logging

`src/infrastructure/logging`: [nestjs-pino](https://github.com/iamolegga/nestjs-pino) with structured JSON.

## Using the logger

Inject the port, never pino directly:

```ts
constructor(@Inject(LoggerPortToken) private readonly logger: LoggerPort) {}

this.logger.warn('db.rollback.failed', { sourceKey: 'main', tag: 'tickets.save', err });
```

- **Messages:** short dotted event names (`db.pool.created`, `ticket.close.rejected`); put details in the meta object. Field names are typed in `src/application/shared/logging.ts` (`LogMeta`: `correlationId`, `useCase`, `aggregate`, `aggregateId`, `http`, `integration`, `err`, …).
- **Never log** secrets, tokens, passwords, bind values, or personal data you don't need (e.g. email addresses).
- **Request context:** `PinoLoggerAdapter` is a singleton, but nestjs-pino resolves the request-bound logger through `AsyncLocalStorage` on every call, so logs written during a request carry its `requestId` automatically.

## What gets logged automatically

| Event                                          | Level                                                                            |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Every HTTP request (pino-http access log)      | `info`; `warn` for 4xx; `error` for 5xx                                          |
| Successful `/health` and `/health/ready` polls | not logged (monitoring noise)                                                    |
| Exceptions handled by `GlobalExceptionFilter`  | `warn` 4xx, `error` 5xx, with cause; trimmed stack when `SHOW_STACK_TRACES=true` |
| Pool created/closed, boot pings                | `info` / `warn` / `error`                                                        |
| Slow queries (`slowQueryMs`)                   | `warn` `db.query.slow`                                                           |
| Context clear failure (connection dropped)     | `warn` `db.context.clear.failed`                                                 |

Request logs include method, URL, request id, client IP, user agent, status and `latencyMs`. The `authorization`, `cookie` and `set-cookie` headers are removed.

## Outputs

| Output                                                                              | When                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `logs/app.log` (pino-roll: daily + `LOGGING_MAX_SIZE`, keeps `LOGGING_FILES_LIMIT`) | `LOGGING_TO_FILE=true` (default)                                   |
| stdout, pretty                                                                      | `LOGGING_PRETTY=true`, or development, and `pino-pretty` installed |
| stdout, JSON                                                                        | otherwise                                                          |

Transport targets run in worker threads, so logging doesn't block requests.

Configuration: [Configuration → Logging](configuration.md#logging).
