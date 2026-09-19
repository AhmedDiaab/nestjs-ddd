# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Every branch
that changes behaviour, configuration or conventions appends an entry here under `## [Unreleased]`;
keep the skeleton (`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`) so entries
stay easy to scan.

## [Unreleased]

### Changed

- Bumped CI Actions to their latest majors: `actions/checkout` v4→v7, `actions/setup-node` v4→v7,
  `actions/upload-artifact` v4→v7, `pnpm/action-setup` v4→v6.
- Bumped `@types/*`, `jest` (→30.5.1) and `@eslint/js` (→9.39.5) within their existing ranges.
- Bumped the lint-and-format toolchain to its next major: `eslint` 9→10, `eslint-plugin-prettier`,
  `prettier` 3.4→3.9, `typescript-eslint` 8.20→8.70. The stricter `no-unnecessary-type-assertion`
  and `no-base-to-string` rules caught real issues, fixed rather than suppressed: `toString()` in
  `common/utils/parse-string.util.ts` now takes a `Stringifiable` union instead of `unknown` (a
  caller could previously pass a plain object and silently get `"[object Object]"` back), and
  `GlobalExceptionFilter`'s non-record `HttpException` fallback only stringifies an actual string
  response instead of any object.

### Deferred

- The `@nestjs/*` 11→12 bump (plus `@nestjs/schedule` 6→12) stays deferred. Root cause and the
  revisit condition: [decision 0014](docs/decisions/0014-nestjs-12-deferred.md). In short:
  `@nestjs/common@12`'s new package `exports` map breaks the `@nestjs/common/interfaces` deep
  import that `nestjs-pino@4.4.1` and every published `@nestjs/throttler` (up to 6.7.0) still use
  in their type declarations, and `@nest-lab/throttler-storage-redis@1.2.0` has no `@nestjs/common@^12`
  peer at all — upstream gaps, not something to patch around here. `.github/dependabot.yml` now
  ignores major bumps for `@nestjs/*` so the PR stops reopening weekly.

## [1.0.0]

Baseline: what this template ships out of the box.

### Added

- Layered/DDD architecture (`interface → application → domain`, infrastructure behind ports)
  enforced by ESLint import rules, `madge` cycle checks and typed DI tokens that make a wrong
  binding fail to compile.
- Domain building blocks (`Entity`, `ValueObject`, `AggregateRoot`, domain errors and events) and
  use cases that return a typed `Result` for expected failures instead of throwing.
- A multi-source database layer (Oracle implemented; other dialects placeholders) with pool
  tuning, boot pings, a readiness probe, `transaction()` per call, a `UnitOfWorkPort` for
  cross-aggregate atomicity, and the acting user carried as Oracle's `CLIENT_IDENTIFIER` per query.
- Domain events published after the write commits to in-process handlers, with a written outbox
  recipe for consumers that must not miss one.
- An HTTP interface with a consistent `{ success, data, meta }` envelope, Zod-validated
  request/response schemas, versioned routes, JWT auth enforced globally (`@Public()` opt-out,
  `@Roles()` for token-carried roles), CSRF protection for cookie auth, and idempotency-key replay
  for POSTs that need to be safe to retry.
- Errors mapped to real HTTP statuses by problem kind, for both returned `Result` failures and
  thrown errors, with internals and ORA codes never reaching clients.
- Security defaults: helmet, a CORS allow-list, rate limiting shared through Redis across
  instances, and body-size limits.
- An outbound HTTP client (per-attempt timeout, safe-method retries, `Retry-After`, a circuit
  breaker per upstream) and cron jobs that skip overlapping runs and drain cleanly on shutdown.
- Observability: Prometheus metrics for HTTP/jobs/pools, W3C trace context propagated across
  services, structured pino logging with redaction, and a graceful shutdown sequence that fails
  readiness first and closes database pools last.
- Unit, e2e, live-Oracle and Windows-service-script test suites, in-memory fakes, and one
  `pnpm verify` gate that CI runs on every pull request alongside a coverage floor.
- Agent-ready conventions: `AGENTS.md`, Claude Code skills, an architecture-reviewer subagent, and
  enforced patterns (AAA tests, named barrel exports, one thing per file).

[Unreleased]: https://github.com/AhmedDiaab/nestjs-ddd/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/AhmedDiaab/nestjs-ddd/releases/tag/v1.0.0
