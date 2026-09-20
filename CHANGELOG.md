# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). Every branch
that changes behaviour, configuration or conventions appends an entry here under `## [Unreleased]`;
keep the skeleton (`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`) so entries
stay easy to scan.

## [Unreleased]

### Added

- Error logs now carry `origin` (and `causeOrigin`, when the error's `cause` chain has a
  different app frame) — the one line of OUR code that created the error, e.g.
  `src/infrastructure/database/dao/oracle-tickets.dao.ts:80 (OracleTicketsDao.findById)` —
  computed by the new framework-free `errorOrigin`/`resolveErrorOrigin`
  (`src/common/utils/error-origin.util.ts`), which scans a stack top-down for the first frame
  that isn't `node_modules` or a `node:` internal instead of trusting the top frame. Always on,
  independent of `SHOW_STACK_TRACES`; the response body sent to clients is unchanged. See
  [decision 0010](docs/decisions/0010-error-origin.md).
- `node --enable-source-maps` (Dockerfile `CMD`, `start:prod`, `start-service.ps1`) so `origin`/
  `causeOrigin` name the `.ts` file and line in a production build.
- Optional in-process TLS termination (`TLS_ENABLED`, default `false`) for deployments with no
  reverse proxy or load balancer in front of the app — the Windows service install in particular.
  `src/infrastructure/tls/load-tls-options.ts` reads `TLS_KEY_FILE`/`TLS_CERT_FILE` (and
  optionally `TLS_CA_FILE`, `TLS_PASSPHRASE`, `TLS_MIN_VERSION`) once at bootstrap, before Nest
  starts; a bad or missing path fails at boot with the path named and never the file's contents
  (`InvalidConfigError`, same as any other invalid config), and the startup log line prints
  `https://` instead of `http://` when it's on. Terminating TLS at the proxy stays the default.
  `.gitignore` now excludes `*.pem`, `*.key`, `*.crt`, `*.cer`, `*.pfx`, `*.p12` so a local
  development certificate can't be committed by accident. See [decision
  0011](docs/decisions/0011-tls-optional-in-process.md) and `docs/architecture/operations.md` §
  TLS.
- Cluster mode (`CLUSTER_ENABLED`, default `false`): multi-core scaling on a single box via Node's
  built-in `cluster` module — no external process manager. `src/infrastructure/cluster/` forks
  `CLUSTER_WORKERS` workers (0 = one per CPU core), respawns one that exits unexpectedly
  (rate-capped by `CLUSTER_RESPAWN_MAX_PER_MINUTE`, off via `CLUSTER_RESPAWN=false`), elects one
  worker as the scheduler leader, and — on `SIGTERM`/`SIGINT` — forwards the signal to every
  worker explicitly (`worker.process.kill(signal)`, not relying on the OS, since Windows does not
  propagate it reliably) before a bounded wait and `SIGKILL` for stragglers. The primary never
  builds a Nest application: no database pools, no HTTP server, no Swagger. Boot-time safety
  rails run before any worker is forked: `IDEMPOTENCY_STORE=memory` with more than one worker now
  fails at boot (`InvalidConfigError`, same posture as any other invalid config);
  `THROTTLE_STORAGE=memory` logs a warning naming the effective limit
  (`THROTTLE_LIMIT × workers`); database pool capacity (`poolMax × workers`) is logged per source.
  Aggregated `/metrics` for the whole cluster is served by the primary on `CLUSTER_METRICS_PORT`
  (`prom-client`'s `AggregatorRegistry` only aggregates from the primary) — a worker's own
  `/metrics` keeps answering with just that worker's numbers. See [decision
  0012](docs/decisions/0012-cluster-primary-owns-forking.md) and
  `docs/architecture/operations.md` § Process model.

### Changed

- `EnvConfigAdapter`'s constructor now optionally accepts an already-loaded `AppConfig`, so
  `main.ts`'s early TLS config read (needed before Nest — and DI — exists) reuses it instead of
  parsing `process.env` a second time to build the `ConfigPort` that `loadTlsOptions` needs; the
  cluster primary reuses the same read again, for its own config and logger.
- `JobScheduler.onApplicationBootstrap()` now also skips registering jobs when clustered and this
  worker is not the elected leader, so `SCHEDULER_ENABLED=true` clusters correctly with no extra
  configuration — its class doc comment is updated to match.
- `PrometheusMetrics` exposes its underlying `Registry` (`registryForAggregation`) and
  `MetricsModule` opts a worker's registry into `AggregatorRegistry.clusterMetrics()` when
  clustered (`registerForClusterAggregation`), so the primary's aggregated `/metrics` includes it.

- `AppError`/`DomainError` base constructors call `Error.captureStackTrace(this, new.target)`
  (V8-only, guarded), so an error's own creation site is captured with the constructor frames
  removed — this is what keeps `origin` accurate across `await` boundaries.
- `GlobalExceptionFilter`'s log meta gained `origin`/`causeOrigin`; the existing `stack` key and
  its `SHOW_STACK_TRACES` gate are unchanged.
- Registered a pino `error` serializer (`src/infrastructure/logging/pino.options.ts`) that
  replaces pino's default FULL, untrimmed-stack handling with
  `{ type, message, origin, causeOrigin?, stack? }` for every call site that logs `{ error }` —
  previously only `GlobalExceptionFilter` was gated by `SHOW_STACK_TRACES`; `job-runner.ts`,
  `in-process-domain-event-publisher.ts`, `pool.manager.ts` and `oracle.client.ts` passed a raw
  `Error` straight to the logger and leaked the full stack ungated. The same serializer is also
  registered at pino-http's own literal `err` key (its automatic access-log line; a key this
  template doesn't control) and unwraps pino-http's own pre-serialization to read the original
  error's stack.
- **Renamed the `LogMeta.err` field to `LogMeta.error`** (`src/application/shared/logging.ts`)
  for a consistent, unabbreviated field name across every call site and the serializer; updated
  `docs/architecture/logging.md` to match.
- Bumped CI Actions to their latest majors: `actions/checkout` v4→v7, `actions/setup-node` v4→v7,
  `actions/upload-artifact` v4→v7, `pnpm/action-setup` v4→v6.
- Bumped `@types/*`, `jest` (→30.5.1) and `@eslint/js` (→9.39.5) within their existing ranges.
- Bumped the lint-and-format toolchain to its next major: `eslint` 9→10, `eslint-plugin-prettier`,
  `prettier` 3.4→3.9, `typescript-eslint` 8.20→8.70. The stricter `no-unnecessary-type-assertion`
  and `no-base-to-string` rules caught real issues, fixed rather than suppressed: `toString()` in
  `common/utils/parse-string.util.ts` now takes a `Stringifiable` union instead of `unknown` (a
  caller could previously pass a plain object and silently get `"[object Object]"` back), and
  `GlobalExceptionFilter`'s non-record `HttpException` fallback now reads a message only from a
  string or a list of strings — anything else falls back to the status name instead of being
  stringified into `"[object Object]"`.

### Fixed

- Reading `.env.<NODE_ENV>` moved from `EnvConfigAdapter`'s constructor into `loadConfig()`. The
  TLS work added a `loadConfig()` call in `main.ts`, before Nest exists, so the earliest parse saw
  a bare environment and any deployment keeping its secrets in the file — `pnpm start:dev` and the
  Windows service setup both do — failed to boot with an invalid-configuration error for the
  variables that live in that file. Real environment variables still win over the file. Found
  while syncing `nestjs-ddd-lean`, which had inherited the same ordering.

### Removed

- The unused `source-map-support` devDependency — `--enable-source-maps` (a native `node` flag,
  no dependency) now serves the same purpose for the built-in error `origin`/`causeOrigin`.

**Deferred:**

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
