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

If there is no proxy, the same order still works: ship the new service alongside, point one client (or one feature flag) at it, then widen.

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
