# 0012. Cluster primary owns forking

- Status: Accepted
- Date: 2026-09-20

## Context

Until now this template has been one process: `CMD ["node", "dist/main.js"]` in Docker, one NSSM
service on Windows. Scaling meant more containers. That is the right default — it is what
[Migrate a legacy service](../guides/migrate-a-legacy-service.md) assumes throughout — but it
leaves no multi-core story for the one deployment this template targets that often has no
container orchestrator to add more instances to: the Windows service install
(`start-service.ps1`). A single Node process uses one core; the rest of the box sits idle.

Node's built-in `cluster` module (`node:cluster`) forks N worker processes that share listen
sockets, giving the multi-core win without a second dependency. The alternative — a process
manager like PM2 — is explicitly out of scope (see Consequences). Nothing named `cluster` existed
in the codebase before this decision; `CLUSTER_ENABLED` defaults to `false`, and the single-process
path is unchanged, byte-for-byte, when it is off.

Forking more than one worker on one box is not free of new failure modes, and the whole point of
doing this "properly" rather than as a thin wrapper around `cluster.fork()` is to make those
failure modes either impossible or loud:

- `IDEMPOTENCY_STORE=memory` keeps claims in one process's memory
  (`src/infrastructure/database/idempotency/in-memory-idempotency.store.ts`). With N workers, a
  claim made on one is invisible to the others — the same request key would be silently treated as
  new work more than once, which is worse than the feature not existing.
- `SCHEDULER_ENABLED=true` (`src/interface/scheduler/job-scheduler.ts`) makes **every** instance
  that has it on run every job. That was already true across separate containers, and forking
  turns it from "an operator's checklist item" into something that happens automatically on every
  boot unless the code itself picks one worker.
- `prom-client`'s `AggregatorRegistry` — the library's own answer to "metrics from a cluster" —
  only aggregates from the primary process, by design (it talks to workers over the same IPC
  channel `cluster` itself uses). A worker's own `/metrics` cannot answer for the whole cluster no
  matter how it is written.
- On Windows, the NSSM service now manages the primary, not a worker. Signal delivery to child
  processes is unreliable there, so the primary must forward `SIGTERM`/`SIGINT` itself rather than
  count on the OS.

## Decision

- **The primary never builds a Nest application.** `src/main.ts` branches on
  `cluster.enabled && cluster.isPrimary` **before** `NestFactory.create` runs, and calls
  `startPrimary()` (`src/infrastructure/cluster/cluster-primary.ts`) instead — no database pools,
  no HTTP server, no Swagger, no DI container. A worker (`cluster.isWorker`) and the single-process
  default (`cluster.enabled` false) both fall through to the bootstrap that already existed. This
  keeps the primary small and hard to crash: the process responsible for respawning workers and
  forwarding shutdown signals should not itself depend on the database being reachable or Nest
  finishing its module graph. It also means the primary's own logger cannot come from Nest DI —
  `PinoProcessLogger` (`src/infrastructure/logging/pino-process-logger.ts`) builds a plain `pino`
  instance from the same transport configuration (`createTransportTargets`,
  `src/infrastructure/logging/pino.options.ts`) the in-app logger uses, so a primary's logs land
  in the same place as its workers' without going through `nestjs-pino`.
- **A memory idempotency store with more than one worker fails at boot, not with a warning.**
  `runClusterBootRails` (`src/infrastructure/cluster/cluster-boot-rails.ts`) throws
  `InvalidConfigError` — the same type and the same `main.ts` catch block as any other invalid
  config — before a single worker is forked. A warning would still let the deployment start and
  silently do the wrong thing under load; nothing about `IDEMPOTENCY_STORE=memory` becoming unsafe
  is a matter of degree the way `THROTTLE_STORAGE=memory` is (worse enforcement, still
  enforcement) — it is either shared state or it is wrong, so it gets the harder failure mode.
  `THROTTLE_STORAGE=memory` gets a warning instead, because a weaker rate limit
  (`THROTTLE_LIMIT × workers` instead of `THROTTLE_LIMIT`) is still a rate limit, just a looser
  one — a judgement call, not a correctness bug, so it is left to the operator rather than refused.
- **The scheduler runs on exactly one worker, elected by the primary, not decided by the
  workers.** `JobScheduler.onApplicationBootstrap()` (`src/interface/scheduler/job-scheduler.ts`)
  now also checks `cluster.enabled && !cluster.isLeader` before registering any cron job. Which
  worker is the leader is not negotiated among workers (no election protocol, no leader lease in a
  shared store) — the primary marks exactly one worker via a `CLUSTER_LEADER` environment variable
  set only at fork time, because the primary already knows the full worker set and is the only
  process that can make that call once, cheaply. When the leader worker exits and is respawned,
  the replacement is forked with the same variable and inherits leadership; if respawn is off, or
  shutdown has begun, leadership is not reassigned rather than triggering a fresh election —
  simpler, and correct for what this template needs (jobs resume on the next deploy or restart).
- **Metrics need a separate port because `AggregatorRegistry` is a primary-side API.** There is no
  way to make a worker's own `/metrics` answer for the whole cluster — the aggregation happens by
  asking every worker over `cluster`'s IPC channel, which only the primary can do. So, when
  clustered and `METRICS_ENABLED=true`, the primary runs a small plain `node:http` server on
  `CLUSTER_METRICS_PORT` (`cluster-metrics-server.ts`) that calls `AggregatorRegistry.clusterMetrics()`
  — not Nest, for the same reason the primary builds no Nest application at all. Each worker opts
  its own registry in with `AggregatorRegistry.setRegistries()`
  (`register-cluster-aggregation.util.ts`, wired from `MetricsModule`) instead of the library's
  default (the global registry, which `PrometheusMetrics` never uses — every instance owns its own
  `Registry`). A worker's own `/metrics` is left exactly as it was: correct for that worker,
  documented as answering for that worker only once clustered.
- **Shutdown fans out explicitly, never by relying on signal propagation.** On `SIGTERM`/`SIGINT`
  the primary calls `worker.process.kill(signal)` on every live worker itself, waits up to
  `drainDelayMs + forceAfterMs + jobDrainMs` plus a small fixed slack, then `SIGKILL`s whatever is
  still alive and exits. Windows in particular does not reliably deliver a console signal to child
  processes, so "the OS will forward it" is not a safe assumption on the one platform this feature
  exists for.

## Consequences

- Cluster mode costs one env var (`CLUSTER_ENABLED`); leaving it off changes no other code path —
  verified by running the full single-process test suite and the manual boot/shutdown checks with
  it unset.
- `JobScheduler`'s class doc comment ("enable it on exactly one instance") now describes the
  cluster case too, since the code enforces it automatically there.
- `docs/architecture/operations.md` § Process model, § Graceful shutdown and § Scheduled jobs, and
  `docs/architecture/configuration.md` § Cluster now document what the primary owns versus a
  worker, the Windows scheduling caveat, and the extra shutdown hop.
- `CLUSTER_LEADER` is real config (`clusterSchema`, `cluster.isLeader`), read through the same
  `ConfigPort` pipeline as everything else, but it is not in `.env.example`: operators never set
  it, the primary does, at fork time, the same way NSSM sets only `NODE_ENV` on the service and
  leaves the rest to `.env.<environment>`.
- Rejected: **PM2, or another external process manager.** It solves forking and respawning, but
  brings its own configuration format, its own log handling, and a dependency this template would
  need to document, install and keep compatible with the Windows service scripts — for
  functionality `node:cluster` already provides. It also does nothing for the actual hard part of
  this feature (the idempotency/throttle/scheduler/metrics rails), which are specific to this
  codebase and would need writing regardless of what forks the workers.
- Rejected: **leaving the safety rails as documentation only** ("if you cluster, remember to set
  `IDEMPOTENCY_STORE=oracle`"). A warning nobody reads at 2am is not a rail. The whole reason this
  item was worth doing "properly" rather than as a thin `cluster.fork()` wrapper was to make the
  dangerous combination (`IDEMPOTENCY_STORE=memory` + more than one worker) impossible to boot
  into, not merely inadvisable.
- Not done here: no leader **election protocol** (no lease, no heartbeat, no renegotiation among
  live workers). The primary's fork-time assignment is sufficient for a single box it already
  supervises; a distributed leader election would be solving a problem this deployment shape
  doesn't have.
