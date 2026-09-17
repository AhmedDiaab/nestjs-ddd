# Known gaps and open items

An honest, dated review of what this template **does not** do, what is weak in what it does do, and what I'd fix first. Kept in the repo so a team adopting the template inherits the list instead of rediscovering it in production.

- **Reviewed**: 2026-09-17, against `feat/oracle-backport` (`e975011`).
- **Scope**: the template itself. Business features built on top are out of scope.
- **How to use it**: before starting a project from this template, walk section 1 and 2 and decide per row — fix it, accept it, or replace it with your platform's version. Cross items off here as you do; delete the ones that don't apply to you.

Terms: [Glossary](glossary.md). Rules the template does enforce: [Architecture overview](architecture/overview.md).

## 1. Defects and risks in what exists

Ordered by how much damage they can do.

**Closed 2026-09-18**: shutdown now fails readiness first, keeps serving while the load balancer notices, drains in-flight requests and closes the database pools last ([Operations](architecture/operations.md#graceful-shutdown)). Authentication used to be opt-in per controller. `JwtGuard` is now a global `APP_GUARD` with a `@Public()` opt-out, so a route that declares nothing is protected; see [Add an authentication strategy](guides/add-an-auth-strategy.md).

| #   | Gap                                                                                                                                                                                                                                                                                                      | Where                                                                      | Suggested fix                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | **The interface layer is not fenced by ESLint.** The import restrictions cover `application/**` and `domain/**` only, so `HealthController` reaches into `@infrastructure/database/*` for `ConnectionProviderToken` and the `ConnectionProvider` contract — which the docs call infrastructure-internal. | `eslint.config.mjs`, `src/interface/http/controllers/health.controller.ts` | Add a `no-restricted-imports` block for `src/interface/**`, and put health behind an application port             |
| 2   | **The request id is taken from the client unvalidated** and written straight into logs and back into the request headers: any length, any bytes, and a caller can forge another request's id.                                                                                                            | `src/infrastructure/logging/pino.options.ts`                               | Accept it only when it matches something like `/^[A-Za-z0-9._-]{1,128}$/`, otherwise generate one                 |
| 3   | **The request id is never returned as a response header**, only inside `meta`. A client or proxy that doesn't parse the envelope can't correlate a failure with our logs.                                                                                                                                | `src/interface/http/common/interceptors/response-formatter.interceptor.ts` | Set the configured header on the response                                                                         |
| 4   | **Domain events are best-effort and that is undersold.** They are dispatched in process after the commit, and a failing handler is logged and swallowed. A crash between the commit and the dispatch loses the event.                                                                                    | `src/application/events/in-process-domain-event-publisher.ts`              | Fine for side effects; say so explicitly in the docs, and add an outbox recipe for events other systems depend on |
| 5   | **`/health/ready` is unauthenticated, exempt from throttling and lists the configured source keys.** In production the error text is hidden, the topology isn't.                                                                                                                                         | `src/interface/http/controllers/health.controller.ts`                      | Keep the liveness probe open; bind the detailed readiness body to an internal route or a token                    |
| 6   | **Nest scaffolding is still in the composition root.** `AppController`/`AppService` answer `GET /` with `'Hello World!'`, belong to no layer and follow none of the conventions the template enforces.                                                                                                   | `src/app.controller.ts`, `src/app.service.ts`, `src/app.module.ts`         | Delete them, or replace with a service-info route that goes through the interface layer                           |

## 2. Missing features

Things a production service usually needs that this template does not provide at all.

**Closed 2026-09-18**: outbound HTTP support (`infrastructure/http`: timeout, retries with backoff and `Retry-After`, a circuit breaker per upstream, correlation id propagation — [guide](guides/call-another-service.md)); CI (`.github/workflows/verify.yml` runs `format:check`, `verify` and the coverage floor on every pull request, plus the Windows script checks; Dependabot for dependencies and actions) and a coverage floor in `jest.config.ts`.

| #   | Missing                          | Why it matters                                                                                                                                                                                                                                                | Note                                                                       |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | **Metrics and tracing**          | No `/metrics`, no OpenTelemetry. Pool statistics are collected inside the Oracle client and never exposed; slow queries only reach the log. "Which endpoint got slower this week" can't be answered without a log pipeline.                                   | Second largest                                                             |
| 2   | **Authorization beyond roles**   | `@Roles()` covers roles carried by the token. Roles or permissions stored in a database, and policies that depend on the resource, are documented ([guide](guides/add-an-auth-strategy.md)) but not provided: no permissions port, no cache, no policy model. | Each project still writes that part                                        |
| 3   | **JWKS / key rotation**          | Only static secrets and algorithms from config. Keycloak, Entra ID and AD FS shops need `jwks_uri` with `kid` selection and caching.                                                                                                                          | `src/infrastructure/auth`                                                  |
| 4   | **Caching**                      | `ioredis` is already a dependency for shared throttling, but there's no cache port, so repeated lookups (roles, reference data) hit the database every request.                                                                                               | A small `CachePort` + Redis/in-memory adapters                             |
| 5   | **Idempotency**                  | No idempotency keys and no dedupe store. Clients retrying through a load balancer will execute a POST twice.                                                                                                                                                  | Matters with the VIP setups in the migration guide                         |
| 6   | **Queues and outbox**            | Cron is the only background mechanism; there is no queue port, no outbox processor, and jobs in flight are not drained on shutdown (the runner only skips overlapping runs).                                                                                  | See also gap 7 in section 1                                                |
| 7   | **Database migrations**          | Nothing, not even a stated position for the case where you _do_ own the schema. The "database you don't own" guide covers the opposite case well.                                                                                                             | Pick a tool and write one page, or say clearly it's out of scope           |
| 8   | **Disposable test database**     | The live Oracle suite needs a database you set up by hand, so it runs rarely — which is exactly how a real bug (errors not mapped when a call joins a unit of work) survived until it was looked for.                                                         | Testcontainers, or a documented one-command container                      |
| 9   | **Multi-tenancy**                | No tenant concept anywhere. The Oracle context user identifies the actor, not a tenant, and is not a data-scoping mechanism.                                                                                                                                  | Add deliberately if you need it; retrofitting is expensive                 |
| 10  | **Deprecation path for the API** | URI versioning works, but there is no `Deprecation`/`Sunset` header helper and no written policy for retiring a version.                                                                                                                                      |                                                                            |
| 11  | **Repository hygiene**           | No LICENSE, CHANGELOG, CONTRIBUTING, pull-request template, commit linting or pre-commit hook — in a repository whose whole purpose is to be forked.                                                                                                          | Conventions are currently enforced by reviewers and agents, not by tooling |
| 12  | **Pagination is unused**         | `shared/pagination` and the pagination schemas exist but no endpoint uses them, so nobody knows whether they work end to end.                                                                                                                                 | Use them in the example endpoint or remove them                            |

## 3. Opinions

Judgement calls rather than defects. Disagree freely — but disagree on purpose.

- **The documentation outruns what is enforced.** Fourteen guides and eight decision records, all containing code that is never compiled. One snippet was broken until someone read it closely, and agents copy from these pages. A test that extracts the TypeScript blocks and type-checks them would keep them honest; without it they rot quietly.
- **`shared` vs `common` vs `application/contracts`** is three buckets for cross-cutting code whose names don't say which is which ("framework-free helpers" vs "Nest helpers" lives only in prose). People will guess wrong. Merge them or rename them for what they are.
- **There are two routes from a failure to an HTTP status**: a returned `Result.err` handled by the interceptor, and a thrown error handled by the filter. Both are documented and both work; two code paths for one outcome still drift eventually. Worth revisiting if the mapping ever disagrees.
- **The dialect placeholders promise portability the code doesn't have.** Only Oracle is implemented. Either implement one more dialect to prove the seam, or say plainly in the README that it is untested.
- **The template is large for a small service.** Roughly 150 source files before any business code. That pays off for a team running several services and is heavy for a single-endpoint one. A short "what you can safely delete" note (scheduler, shared throttler storage, CSRF, Swagger) would make it fit both.
- **What the template gets right**, for balance: layer boundaries that actually fail the build, typed DI tokens where a wrong binding doesn't compile, the context-user lifecycle, error-to-status mapping that never leaks internals, and configuration that fails fast without printing secrets. The gaps above are additions, not rewrites.

## 4. What I'd fix first

1. Metrics and tracing.
2. Fence the interface layer in ESLint and move health behind an application port.
3. Validate the incoming request id and echo it on the response.
4. Delete the `Hello World` scaffolding.

Items 2, 3 and 4 are an afternoon each. Item 1 is the one that changes how the service is operated.

## Environment items (not code)

- The API container in `docker-compose.yml` has never been built or run here: Docker Desktop ran out of disk during the attempt, and the stack was used with Oracle in Docker and the API on the host.
- The Windows service scripts are checked in a PowerShell container (`pnpm test:service-scripts`); registering the service on a real Windows machine is still unverified.
