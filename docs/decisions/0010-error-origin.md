# 0010. Log the error's origin frame, not a stack trace

- Status: Accepted
- Date: 2026-09-19

## Context

`GlobalExceptionFilter` already logged a trimmed stack, but only when `SHOW_STACK_TRACES=true` (default `false`), and `formatStackTrace` kept only the first three `/src/` frames of the TOP-level error — a driver error's own frames (`node_modules/oracledb/...`, `node:internal/...`) were filtered out, but its wrapping wasn't followed, so the `cause` (where the actual failure happened) was invisible.

Worse, three other call sites — `job-runner.ts`, `in-process-domain-event-publisher.ts`, `pool.manager.ts` (and, found during implementation, `oracle.client.ts`) — passed a raw `Error` as `meta.error` (originally `meta.err`) straight to the logger. pino's built-in `err`/`error` handling then serialized the FULL, untrimmed stack for those, ungated by `SHOW_STACK_TRACES`, including every `node_modules` and `node:` frame. That defeated the point of the filter's gate: a leak was always one `logger.error(msg, { error })` call away.

Either way, what a reader actually needs when an error is logged is one thing: which line of OUR code threw it. A full stack is noise (most of it is framework/driver plumbing); the top frame alone is frequently wrong (a database driver's top frames are its own internals, not our call site).

## Decision

- **Log one frame, not a stack.** `errorOrigin`/`resolveErrorOrigin` (`src/common/utils/error-origin.util.ts`, framework-free) scan an error's stack top-down for the first frame that is ours — inside the project (`/src/` or `/dist/`), never `node_modules`, never a `node:` internal — and format it as `path/file.ts:42 (Class.method)`. Scanning the whole stack, not just the top frame, matters: when a driver throws, the top frames are dependency frames and the first frame of ours is further down, at the line that actually called into the driver.
- **Follow the `cause` chain.** `DatabaseExecutionError`, `InfrastructureError` and `UnexpectedError` wrap a lower-level error as `cause`. `resolveErrorOrigin` reports `origin` (the outermost error in the chain that has an app frame) and, when it differs, `causeOrigin` (a deeper app frame from the `cause` chain) — e.g. the DAO line that wrapped a driver error, and the line inside that call that actually failed. A cyclic `cause` chain is guarded with an identity set and a depth cap; nothing in the chain having an app frame returns `undefined` rather than inventing one.
- **`origin`/`causeOrigin` are always on**, independent of `SHOW_STACK_TRACES`. They never carry more than a file path, a line number and a function name — nothing an attacker could use that a full stack wouldn't already leak far more of, and nothing that identifies a request or a user. The full `stack` stays behind `SHOW_STACK_TRACES=true` (default `false`), trimmed the same way as before.
- **One pino serializer fixes every call site at once.** `src/infrastructure/logging/pino.options.ts` registers a serializer for our own `error` key (`{ type, message, origin, causeOrigin?, stack? }`) instead of requiring every call site to compute its own origin. It is also registered at the literal key `err`, because pino-http's own automatic access-log line builds its error object under that key (a key this template does not control) — the same serializer keeps that line trimmed too, and unwraps pino-http's own pre-serialization (`{ type, message, stack, raw: <original error> }`) to read the real stack from `raw`.
- **`AppError`/`DomainError` call `Error.captureStackTrace(this, new.target)`** (V8-only, guarded) in their base constructors, so an error's own creation site is captured with the constructor frames removed. Without this, an error constructed deep in a call chain and thrown after an `await` can end up with a stack whose first frames are unrelated microtask plumbing rather than the actual `new SomeError(...)` call site.
- **`--enable-source-maps`** is passed to `node` in the Dockerfile, `start:prod` and `start-service.ps1` (zero new dependency — `sourceMap: true` already ships `dist/**/*.js.map`), so `origin`/`causeOrigin` name the `.ts` file and line in a production build, not the compiled `.js` line. The unused `source-map-support` devDependency is removed in the same change — it solved this for older Node versions that didn't support `--enable-source-maps` natively.

## Consequences

- Every error log line answers "where in our code did this happen?" in one grep-able string, without a human (or an on-call engineer at 3am) scrolling a stack trace to find the one relevant frame among framework noise.
- Client-facing HTTP responses are unchanged: `origin`/`causeOrigin` are a log-only concern, added in `GlobalExceptionFilter`'s private `log()` and the pino serializer, never in the response body that `catch()` builds.
- A frame can still be wrong if code swallows an error and re-throws a brand new one without a `cause` — `resolveErrorOrigin` can only follow what the error chain actually records.
- `/test/` counts as our code alongside `/src/` and `/dist/`, so an error thrown inside a spec names the spec line instead of reporting nothing. Because the scan is top-down, a stack that passes through both still reports the application frame — the spec frame only wins when the spec itself threw. Production stacks never contain `/test/`.
- Rejected: **logging a full stack unconditionally** — it's what this decision replaces; a stack is harder to grep, easier to accidentally paste somewhere it shouldn't be, and mostly framework frames anyway. Kept behind `SHOW_STACK_TRACES` for the rare case a full trace is still wanted.
- Rejected: **exposing `origin`/`causeOrigin` (or any stack detail) to clients** — a file path and internal class/method name is exactly the kind of implementation detail `ErrorPresenter`/`toProblem()` already keep out of responses (decision [0004](0004-result-errors-to-http-status.md)); this decision only ever writes them to logs.
