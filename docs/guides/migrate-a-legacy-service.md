# Migrate a legacy service to this template

For moving an existing API (Express/NestJS/other) onto this template **without a big-bang rewrite**: endpoint by endpoint, with the old service still serving traffic until each route is proven.

Terms used here: [Glossary](../glossary.md). Layer rules: [Architecture overview](../architecture/overview.md).

## The approach

Run both services and move routes one at a time (strangler pattern):

```text
clients ─► reverse proxy ─┬─► legacy service      (everything not migrated yet)
                          └─► new service         (routes already moved, one by one)
```

Why not a rewrite in one go: the old behaviour is the specification, quirks included. Moving one route at a time lets you compare old and new responses for real traffic, and roll a route back by changing one proxy rule.

If there is no proxy you control, see [No proxy: behind a VIP or load balancer](#no-proxy-behind-a-vip-or-load-balancer) for how to get the same route-by-route safety.

## No proxy: behind a VIP or load balancer

A common setup: clients hit one hostname on a VIP (F5, NetScaler, HAProxy, cloud LB) that balances across servers running the legacy service, and the network team owns it. Pick the first option that your VIP and your access allow:

| Option                         | How it works                                                                                                                                              | Switch / roll back                | Use when                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------- |
| **A. Path routing on the VIP** | ask the network team for content switching: `/v1/tickets*` → new pool, everything else → legacy pool (F5 iRule, HAProxy `use_backend`, ALB listener rule) | one VIP rule per route            | the VIP can route by URI: usually the least work and the safest |
| **B. New service in front**    | the VIP keeps one pool, now pointing at the new service; the new service serves migrated routes and forwards the rest to the legacy service               | deploy/revert the forwarding list | you own the new service's deployment but not the VIP            |
| **C. Legacy forwards**         | the VIP keeps pointing at the legacy service; in it, migrated paths are forwarded to the new service                                                      | one list in legacy config         | touching legacy is acceptable and easier than changing the VIP  |
| **D. Blue/green by pool**      | the new service must serve **every** route; the VIP moves the whole hostname from the legacy pool to the new pool                                         | switch the pool back              | the service is small enough to finish in one go                 |
| **E. Second hostname**         | new hostname/VIP for the new service; clients move endpoint by endpoint                                                                                   | per client                        | few, cooperative clients (internal callers)                     |

Options B and C mean requests pass through an extra hop while the migration runs; remove it when the last route has moved.

### If you take option B (new service in front)

The template ships a forwarder: `src/infrastructure/legacy/`, wired from `src/main.ts`, kept dumb on purpose ([decision 0013](../decisions/0013-legacy-forwarder-is-dumb-transport.md)):

- Forward **only** what is not migrated: `LEGACY_FORWARD_PREFIXES` lists the path prefixes to send on; everything else still answers through this app, and `FallbackController` keeps answering 404 for genuinely unknown paths.
- Request and response bodies stream through unchanged (`node:http`/`node:https`, not `FetchHttpClient` — that one buffers via `response.text()`); nothing is parsed, re-wrapped in the envelope, or logged.
- `Authorization`, cookies, the request-id header (`REQUEST_ID_HEADER`) and `X-Forwarded-For` pass through; the client IP is appended to `X-Forwarded-For`, or set when it is missing.
- The forwarder has its own timeout, `LEGACY_TIMEOUT_MS`, kept below the VIP's; it logs `legacy.forward.failed` with the method, path and status, never the body or headers.
- **The legacy status passes straight through, untouched — including 4xx and 5xx.** This is the one deliberate departure from [Call another service](call-another-service.md): a forwarder is dumb transport, not a gateway, so an upstream 500 arrives at the client as 500, never mapped to a `Result` or turned into a 503.
- A single list of forwarded prefixes lives in config (`LEGACY_FORWARD_PREFIXES`), so shrinking it as routes migrate is one deployment.

Turn it on with `LEGACY_FORWARD_ENABLED=true`, `LEGACY_TARGET_URL` and at least one entry in `LEGACY_FORWARD_PREFIXES` ([Configuration § Legacy forwarding](../architecture/configuration.md#legacy-forwarding)). Because it pipes the raw request stream, it is wired with `app.use()` in `main.ts` — the composition root — immediately after `helmet()` and before the body parsers, and consequently before `RequestContextMiddleware`; it resolves its own request id from `REQUEST_ID_HEADER`, generating one when the caller sent none.

#### How a route actually moves

**A forwarded prefix always wins over a route implemented here.** The forwarder sits in front of the router, so a controller you write for a path still covered by `LEGACY_FORWARD_PREFIXES` never runs — the request is on its way to the old service before Nest looks at its routes. Three things follow:

- **Migration happens per prefix, not per route inside a prefix.** To move one endpoint out of a prefix you still forward, the prefixes have to be fine-grained enough to say so: forward `/v1/orders/archive` while `/v1/orders` moves, rather than trying to half-migrate `/v1/orders`.
- **Cutover is one deployment that does both halves**: the routes exist here _and_ the prefix leaves the list. Ship the controller first and it is dead code; remove the prefix first and the traffic 404s.
- **A forwarded prefix is a security boundary.** Forwarded requests never reach this app's guards, so `JwtGuard`, `RolesGuard`, the CSRF guard, rate limiting and Zod validation do not run on them, and neither does `RequestContextMiddleware`. That is correct for a dumb hop — the legacy service still owns authentication for the routes it still serves — but it means a route can look migrated in this repository while the old service is the one actually serving and securing it. `helmet()` still applies, since it is registered first; CORS does not, being registered later.

When the last prefix leaves the list, set `LEGACY_FORWARD_ENABLED=false` and delete the variables. Nothing else has to change, because nothing in the application ever depended on the forwarder being there.

### Whatever option you take, behind a VIP check these

| Concern                | What to do                                                                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Health checks**      | point the VIP's monitor at `GET /health` (200, no auth, not rate limited). Use `/health/ready` for deployment readiness, not for the VIP monitor, so a brief database blip doesn't pull every member out |
| **Client IP**          | the VIP hides it: set `TRUST_PROXY=true` so throttling and logs use `X-Forwarded-For` instead of the VIP's address                                                                                       |
| **Rate limiting**      | counters are per instance; with several members behind a VIP set `THROTTLE_STORAGE=redis` and `THROTTLE_REDIS_URL` ([Configuration](../architecture/configuration.md))                                   |
| **TLS**                | usually terminated at the VIP; the app speaks plain HTTP inside. Keep `CORS_ORIGINS` and any cookie `Secure`/`SameSite` settings written for the **public** scheme and host                              |
| **Timeouts**           | keep `KEEP_ALIVE_TIMEOUT` above the VIP's idle timeout and `SERVER_TIMEOUT` below its request timeout, or you get sporadic 502s                                                                          |
| **Draining**           | on deploy, take the member out of the pool first, then stop the process: shutdown hooks drain the database pool ([Operations](../architecture/operations.md))                                            |
| **Database sessions**  | every member opens its own pool: `poolMax × instances` must stay under what the DBA allows                                                                                                               |
| **Tokens and secrets** | every member verifies with the same `JWT_SECRET`/issuer/audience; identical config across members                                                                                                        |
| **Sticky sessions**    | not needed (no server-side session). Ask for them to be off, so one member's restart doesn't strand clients                                                                                              |

### Proving routes without a proxy

- **Compare before switching**: replay captured requests against both services in a test environment and diff the responses; with option B or C you can also mirror a copy of production traffic to the new service and log differences only.
- **Widen slowly**: option A per path, option E per client, option D per environment (test → staging → production).
- **Have the rollback ready**: the VIP rule, forwarding list or pool member you will change, written down before the switch, and test it once in staging.

## 1. Inventory before writing code

Write down, per endpoint: method, path, request shape, response shape, status codes, auth, which tables/procedures it touches, and who calls it. Mark each:

| Mark           | Meaning                       | Move it…                            |
| -------------- | ----------------------------- | ----------------------------------- |
| **read-only**  | only SELECTs                  | first: lowest risk, easy to compare |
| **write**      | changes data                  | after the reads of the same area    |
| **batch/cron** | not HTTP                      | last, or keep in the old service    |
| **dead**       | nothing calls it (check logs) | delete instead of migrating         |

Also capture the environment: variables, secrets, log destinations, service accounts, database users, and the deployment method (Windows service, container).

## 2. Set up the new service

```bash
pnpm install
pnpm rename-project orders-api "Order Desk"   # package name, APP_NAME, Swagger title, service name
cp .env.example .env.development
```

- **Database**: one entry per schema/user in `DATABASE_CONFIG_JSON`, keys in `src/infrastructure/database/sources.ts` ([Add a database source](add-database-source.md)). Reuse the legacy database as it is; do not redesign the schema during the migration.
- **Config**: every legacy env var goes through a Zod schema ([Add a config variable](add-config-variable.md)). Drop the ones nothing reads.
- **Auth**: if the legacy service issues JWTs, keep the issuer and set `JWT_SECRET`/`JWT_ISSUER`/`JWT_AUDIENCE`/`JWT_ALGORITHMS` to match, so existing tokens work. This template only verifies tokens; it doesn't issue them.
- **Response shape**: this template wraps every response in `{ success, data, meta }` ([HTTP interface](../architecture/http-interface.md)). Decide **before** moving the first route: keep the envelope (clients must adapt, so version the API or coordinate) or keep the legacy shape for migrated routes and add the envelope at the next major version.

## 3. Port one endpoint

Take the first read-only endpoint and follow the layers **inside-out**, using the legacy code as the source of truth:

| Legacy piece                                       | Goes to                                                         | Guide                                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| SQL string / ORM query for reads                   | DAO behind a query port; returns a read model                   | [Add a query port and DAO](add-query-port-and-dao.md)                                                  |
| SQL that loads and saves one record with rules     | repository + aggregate                                          | [Add a repository](add-repository.md), [Add a value object and entity](add-value-object-and-entity.md) |
| stored procedure call                              | gateway port + adapter                                          | [Work with a database you don't own](work-with-a-database-you-dont-own.md)                             |
| "service"/"manager" method with the business logic | use case                                                        | [Add a use case](add-use-case.md)                                                                      |
| controller/route handler                           | controller: validate, call one use case, return its `Result`    | [Add a controller](add-controller.md)                                                                  |
| `res.status(409).json(...)` and thrown strings     | application/domain errors whose problem kind maps to the status | [Add an error](add-error.md)                                                                           |
| model/DTO classes                                  | read model (reads) or aggregate + row type (writes)             | [Glossary](../glossary.md)                                                                             |
| `console.log`                                      | `LoggerPort` with dotted event names                            | [Logging](../architecture/logging.md)                                                                  |
| globals, singletons, `require` at call time        | constructor injection through tokens                            | [Dependency injection](../architecture/dependency-injection.md)                                        |

Rules that save pain later:

- **Don't** copy ORM entities into `src/domain`. They carry persistence concerns; map rows to your own aggregate or read model.
- **Don't** port dead branches "just in case". Remove them; git keeps the history.
- **Keep the legacy SQL text** at first (same joins, same hints). Optimise only after the route behaves identically.
- **Bind every value** and whitelist `ORDER BY`, even when the legacy code concatenated strings ([Database](../architecture/database.md)).
- Legacy transaction boundaries that span several statements become one `transaction()` or a [unit of work](add-repository.md#multiple-aggregates-in-one-transaction).

## 4. Prove it matches

Before switching traffic for a route:

1. **Characterisation tests**: capture real legacy responses (status, body, headers) for representative inputs, then assert the new route returns the same. Keep them as e2e tests ([Write tests](write-tests.md)).
2. **Shadow compare** (optional, for busy routes): let the proxy send a copy of production requests to the new service, log differences, change nothing for clients.
3. **Live database checks**: for SQL ported by hand, add a live test ([Testing → Live Oracle tests](../architecture/testing.md#live-oracle-tests)) so paging, MERGE and procedures are exercised against the real database.
4. `pnpm verify` stays green.

Expect small differences: date formats, number precision, `null` vs missing fields, error bodies. Decide per case whether to match the legacy exactly or to fix it deliberately and tell the clients.

## 5. Switch and repeat

1. Point the proxy for that path at the new service.
2. Watch logs and `/health/ready`; roll back by reverting the proxy rule.
3. Delete the legacy handler once traffic is zero for a while, so nobody edits both.
4. Repeat, grouping routes by feature so each aggregate lives in one service.

Keep a table in the repo of migrated vs pending routes; it answers "where does this endpoint live now?" during the transition.

## Shared database: the risky part

Both services usually write the same tables for a while.

- **Don't** run schema changes for the new service while the old one reads those tables; coordinate any change with the DB owners.
- **Write the same columns** the legacy code writes, including audit fields (`updated_by`, timestamps). Pass the user through as `actor` so Oracle sees the right `CLIENT_IDENTIFIER` ([Database → Context user](../architecture/database.md#context-user-lifecycle)).
- **Split by aggregate, not by column**: one service owns writing a table, or the two can overwrite each other's changes.
- Watch for legacy triggers and jobs that fire on writes; your new path must trigger the same ones.

## What not to migrate

- Batch jobs and schedulers: keep them where they are, or move them to their own service. This template is an HTTP API.
- Session state in memory: this template has no session store; use the JWT, or an external store.
- Legacy admin endpoints nobody uses: delete.

## Checklist per endpoint

- [ ] Inputs validated with Zod, no `req.query` assignment
- [ ] Business rules in a use case or aggregate, not in the controller
- [ ] SQL in a DAO/repository/gateway with bound values and a `tag`
- [ ] Errors mapped to the same statuses the legacy returned (or a documented change)
- [ ] Unit tests for the rules, e2e for the route, live test for hand-ported SQL
- [ ] Response compared against the legacy output
- [ ] Proxy rule switched, legacy handler deleted after traffic is zero
