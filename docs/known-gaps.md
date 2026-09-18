# Known gaps and open items

An honest, dated review of what this template **does not** do, what is weak in what it does do, and what I'd fix first. Kept in the repo so a team adopting the template inherits the list instead of rediscovering it in production.

- **Reviewed**: 2026-09-17, against `feat/oracle-backport` (`e975011`).
- **Scope**: the template itself. Business features built on top are out of scope.
- **How to use it**: before starting a project from this template, walk section 1 and 2 and decide per row — fix it, accept it, or replace it with your platform's version. Cross items off here as you do; delete the ones that don't apply to you.

Terms: [Glossary](glossary.md). Rules the template does enforce: [Architecture overview](architecture/overview.md).

## 1. Defects and risks in what exists

Ordered by how much damage they can do.

**Closed 2026-09-18**: the `Hello World` scaffolding is gone and `AppModule` is now only a composition root. Correlation ids from outside are now validated before they reach the logs, and both the request id and the W3C `traceparent` come back as response headers ([Observability](architecture/observability.md)). Shutdown now fails readiness first, keeps serving while the load balancer notices, drains in-flight requests and closes the database pools last ([Operations](architecture/operations.md#graceful-shutdown)). Authentication used to be opt-in per controller. `JwtGuard` is now a global `APP_GUARD` with a `@Public()` opt-out, so a route that declares nothing is protected; see [Add an authentication strategy](guides/add-an-auth-strategy.md).

**Closed 2026-09-18** (the same day, a second pass): the interface layer is now fenced — `src/interface/**` cannot import from `@infrastructure` at all, enforced by an ESLint `no-restricted-imports` block and kept honest by `test/unit/layers/interface-fence.spec.ts`. `HealthController` no longer reaches into `ConnectionProviderToken`/`ConnectionProvider`; it goes through a new application port, `DatabaseHealthPort`, backed by a `PoolHealthAdapter` in infrastructure. `GET /health/ready` now answers `{status}` only; the per-source topology (dialect, latency, error text) moved to an authenticated `GET /v1/health/sources` (`@Roles('admin')`), and a failing source is still logged at `warn` (`health.ready.failed`) for anyone without a token. Domain event delivery is no longer just implied: `DomainEventPublisherPort`'s JSDoc states the guarantee (at-most-once, in process, after the commit) and `InProcessDomainEventPublisher` now counts `domain_events_published_total` and `domain_event_handler_failures_total` by event name, so a handler that always throws shows up on a dashboard instead of only in logs. [`docs/guides/deliver-events-reliably.md`](guides/deliver-events-reliably.md) has the outbox recipe for events another system depends on.

Nothing is outstanding in this section right now — the three rows that used to live here are the ones closed above. See section 2 for what is still genuinely missing.

## 2. Missing features

Things a production service usually needs that this template does not provide at all.

**Closed 2026-09-18**: metrics and tracing (Prometheus `/metrics` for HTTP in and out, jobs and pools, off by default; W3C trace context across services and in every log line — [Observability](architecture/observability.md)); outbound HTTP support (`infrastructure/http`: timeout, retries with backoff and `Retry-After`, a circuit breaker per upstream, correlation id propagation — [guide](guides/call-another-service.md)); CI (`.github/workflows/verify.yml` runs `format:check`, `verify` and the coverage floor on every pull request, plus the Windows script checks; Dependabot for dependencies and actions) and a coverage floor in `jest.config.ts`.

| #   | Missing                          | Why it matters                                                                                                                                                                                                                                                | Note                                                                       |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | **Authorization beyond roles**   | `@Roles()` covers roles carried by the token. Roles or permissions stored in a database, and policies that depend on the resource, are documented ([guide](guides/add-an-auth-strategy.md)) but not provided: no permissions port, no cache, no policy model. | Each project still writes that part                                        |
| 2   | **JWKS / key rotation**          | Only static secrets and algorithms from config. Keycloak, Entra ID and AD FS shops need `jwks_uri` with `kid` selection and caching.                                                                                                                          | `src/infrastructure/auth`                                                  |
| 3   | **Caching**                      | `ioredis` is already a dependency for shared throttling, but there's no cache port, so repeated lookups (roles, reference data) hit the database every request.                                                                                               | A small `CachePort` + Redis/in-memory adapters                             |
| 4   | **Idempotency**                  | No idempotency keys and no dedupe store. Clients retrying through a load balancer will execute a POST twice.                                                                                                                                                  | Matters with the VIP setups in the migration guide                         |
| 5   | **Queues and outbox**            | Cron is the only background mechanism; there is no queue port, no outbox processor, and jobs in flight are not drained on shutdown (the runner only skips overlapping runs).                                                                                  | See also gap 7 in section 1                                                |
| 6   | **Database migrations**          | Nothing, not even a stated position for the case where you _do_ own the schema. The "database you don't own" guide covers the opposite case well.                                                                                                             | Pick a tool and write one page, or say clearly it's out of scope           |
| 7   | **Disposable test database**     | The live Oracle suite needs a database you set up by hand, so it runs rarely — which is exactly how a real bug (errors not mapped when a call joins a unit of work) survived until it was looked for.                                                         | Testcontainers, or a documented one-command container                      |
| 8   | **Multi-tenancy**                | No tenant concept anywhere. The Oracle context user identifies the actor, not a tenant, and is not a data-scoping mechanism.                                                                                                                                  | Add deliberately if you need it; retrofitting is expensive                 |
| 9   | **Deprecation path for the API** | URI versioning works, but there is no `Deprecation`/`Sunset` header helper and no written policy for retiring a version.                                                                                                                                      |                                                                            |
| 10  | **Repository hygiene**           | No LICENSE, CHANGELOG, CONTRIBUTING, pull-request template, commit linting or pre-commit hook — in a repository whose whole purpose is to be forked.                                                                                                          | Conventions are currently enforced by reviewers and agents, not by tooling |
| 11  | **Pagination is unused**         | `shared/pagination` and the pagination schemas exist but no endpoint uses them, so nobody knows whether they work end to end.                                                                                                                                 | Use them in the example endpoint or remove them                            |

## 3. Opinions

Judgement calls rather than defects. Disagree freely — but disagree on purpose.

- **The documentation outruns what is enforced.** Fourteen guides and eight decision records, all containing code that is never compiled. One snippet was broken until someone read it closely, and agents copy from these pages. A test that extracts the TypeScript blocks and type-checks them would keep them honest; without it they rot quietly.
- **`shared` vs `common` vs `application/contracts`** is three buckets for cross-cutting code whose names don't say which is which ("framework-free helpers" vs "Nest helpers" lives only in prose). People will guess wrong. Merge them or rename them for what they are.
- **There are two routes from a failure to an HTTP status**: a returned `Result.err` handled by the interceptor, and a thrown error handled by the filter. Both are documented and both work; two code paths for one outcome still drift eventually. Worth revisiting if the mapping ever disagrees.
- **The dialect placeholders promise portability the code doesn't have.** Only Oracle is implemented. Either implement one more dialect to prove the seam, or say plainly in the README that it is untested.
- **The template is large for a small service.** Roughly 150 source files before any business code. That pays off for a team running several services and is heavy for a single-endpoint one. A short "what you can safely delete" note (scheduler, shared throttler storage, CSRF, Swagger) would make it fit both.
- **What the template gets right**, for balance: layer boundaries that actually fail the build, typed DI tokens where a wrong binding doesn't compile, the context-user lifecycle, error-to-status mapping that never leaks internals, and configuration that fails fast without printing secrets. The gaps above are additions, not rewrites.

## 4. What I'd fix first

Section 1 is empty now, so the real decisions live in section 2. In roughly the order they tend to bite:

1. **Authorization beyond roles** (row 1) — decide this before the first feature that needs resource-level checks, not after; retrofitting a policy model onto endpoints already shipped is the expensive path.
2. **Queues and outbox** (row 5) — the direct follow-on from the events guarantee above: if a feature needs at-least-once delivery, this is where that gets built, on the existing `JobRunner`.
3. **Idempotency** (row 4) — matters as soon as a client sits behind a load balancer or a retrying gateway; pairs naturally with the outbox work.
4. **Caching** (row 3) — `ioredis` is already a dependency for shared throttling; reuse it for a `CachePort` before every request hits the database for the same lookup.

The rest of section 2 (JWKS rotation, migrations, a disposable test database, multi-tenancy, API deprecation, repository hygiene, pagination) is real but lower urgency than the four above for most teams forking this template.

## Environment items (not code)

- The API container in `docker-compose.yml` has never been built or run here: Docker Desktop ran out of disk during the attempt, and the stack was used with Oracle in Docker and the API on the host.
- The Windows service scripts are checked in a PowerShell container (`pnpm test:service-scripts`); registering the service on a real Windows machine is still unverified.
