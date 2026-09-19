# Nestjs Domain Driven Design

NestJS 11 starter template for layered / DDD HTTP services: consistent response envelope, structured logging, fail-fast config, multi-source database layer (Oracle implemented), JWT verification, enforced layer boundaries, and an agent-ready setup.

## Features

| Area                       | What you get                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture**           | interface → application → domain with infrastructure behind ports, enforced by ESLint import rules, `madge` cycle checks and typed DI tokens (a wrong binding doesn't compile)                     |
| **Domain building blocks** | `Entity`, `ValueObject`, `AggregateRoot`, domain errors, domain events recorded by aggregates                                                                                                      |
| **Use cases**              | one class per intention, `Result` for expected failures, typed failure unions, no HTTP or driver types                                                                                             |
| **Database**               | multiple sources from JSON config; Oracle (node-oracledb thin or thick) with full pool tuning, boot pings with retry, readiness probe, graceful drain; placeholders for other dialects             |
| **Data access shapes**     | repositories for aggregates, query ports + DAOs for reads, gateway ports for another team's procedures ([glossary](docs/glossary.md))                                                              |
| **Transactions**           | `transaction()` per call and a `UnitOfWorkPort` that makes several repository calls atomic, rolling back on a thrown error or a failed `Result`                                                    |
| **Context user per query** | the acting user is Oracle's `CLIENT_IDENTIFIER` for one call, cleared before the connection returns to the pool                                                                                    |
| **Domain events**          | published after the write commits to in-process handlers; a failing handler is logged, not fatal                                                                                                   |
| **HTTP**                   | consistent `{ success, data, meta }` envelope, Zod validation (Express 5 safe), JWT from cookie or bearer with algorithm/issuer/audience checks, versioned routes                                  |
| **Errors → status**        | `Result` failures and thrown errors map to real statuses by problem kind (404, 409, 422, 503…); internals and ORA codes never reach clients                                                        |
| **Authentication**         | JWT verified on every route by a global guard; routes open up with `@Public()`, so a new endpoint is protected by default; cookie or bearer, with algorithm/issuer/audience checks                 |
| **Authorization**          | `@Roles()` for roles carried by the token (checked globally, 403 on a mismatch); guidance for roles stored in a database and for checks that depend on the resource                                |
| **Security**               | helmet, CORS allow-list, rate limiting (shared through Redis when you run several instances), CSRF protection for cookie auth, body-size limits, no secrets in config errors or logs               |
| **TLS**                    | optional in-process HTTPS (`TLS_ENABLED`, off by default) for deployments with no reverse proxy in front of the app — the Windows service install in particular; a bad key/cert path fails at boot |
| **API docs**               | Swagger generated from the same Zod schemas that validate requests, off in production by default                                                                                                   |
| **Outbound HTTP**          | one client for calls to other services: per-attempt timeout, retries that only repeat safe methods, `Retry-After`, a circuit breaker per upstream, and the correlation id passed along             |
| **Scheduled jobs**         | cron jobs as a delivery mechanism, off by default, with overlap skipping and failures that can't kill the process                                                                                  |
| **Configuration**          | env → Zod schemas → typed `config.get('http.port')`; unknown keys don't compile, invalid config fails at startup without printing values                                                           |
| **Observability**          | Prometheus metrics for HTTP in and out, jobs and pools (off by default), W3C trace context continued across services, and trace ids on every log line                                              |
| **Logging**                | structured pino logs with request correlation, rotation, redaction, and silent successful health polls                                                                                             |
| **Graceful shutdown**      | readiness fails first so the load balancer stops routing, the instance keeps serving while it notices, in-flight requests finish, stragglers are cut, and the database pools close last            |
| **Operations**             | `/health` and `/health/ready` for monitors and load balancers, graceful shutdown with pool drain, Dockerfile and compose stack, Windows service scripts (NSSM)                                     |
| **Testing**                | unit, e2e, live Oracle and PowerShell suites; in-memory fakes; one `pnpm verify` gate                                                                                                              |
| **Agent-ready**            | `AGENTS.md`, Claude Code skills, a reviewer subagent, and enforced conventions (AAA tests, named barrel exports, one thing per file)                                                               |
| **Project setup**          | `pnpm rename-project` sets the project name everywhere; guides for migrating a legacy service and for databases owned by another team                                                              |

## Quick start

```bash
pnpm install
pnpm rename-project orders "Order Desk"   # new project: set its name (kebab-case) and display title
cp .env.example .env.development   # set NODE_ENV=development and JWT_SECRET (≥ 32 chars)
pnpm start:dev                      # http://localhost:3000/v1, docs at /docs, health at /health
pnpm verify                         # typecheck, lint, cycles, unit + e2e tests, build
```

Requires Node.js ≥ 22.18 and pnpm 10. With `DATABASE_CONFIG_JSON` unset, the app runs without a database.

The project compiles with its own TypeScript (5.9) and with the TypeScript 6 bundled in current VS Code. To match the command line exactly, run **TypeScript: Select TypeScript Version → Use Workspace Version** in VS Code.

With Docker (API + Oracle Database Free):

```bash
cp .env.docker.example .env.docker   # set JWT_SECRET and the Oracle passwords
docker compose --env-file .env.docker up --build
```

## Documentation

**[docs/README.md](docs/README.md)** routes you to the right document:

- [Glossary](docs/glossary.md): repository, DAO, query port, gateway, read model… and which to use
- [Architecture overview](docs/architecture/overview.md): layers, rules, folder map, request lifecycle
- [Feature walkthrough](docs/guides/feature-walkthrough.md): build a feature end to end, with step-by-step guides
- [Database](docs/architecture/database.md) · [Configuration](docs/architecture/configuration.md) · [HTTP interface](docs/architecture/http-interface.md) · [Testing](docs/architecture/testing.md) · [Operations](docs/architecture/operations.md)
- [Migrate a legacy service](docs/guides/migrate-a-legacy-service.md) · [Work with a database you don't own](docs/guides/work-with-a-database-you-dont-own.md)
- [Known gaps and open items](docs/known-gaps.md): what the template does not do, and what to fix first
- [Decisions](docs/decisions/README.md): why things are the way they are
- [Agentic development](docs/agentic-development.md) and [`AGENTS.md`](AGENTS.md): working with AI coding agents

## Scripts

| Script                                                     | Purpose                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm start:dev` / `start:debug` / `start:repl`            | local development                                                                                                   |
| `pnpm build` / `start:prod`                                | production build / run (`NODE_ENV` from environment)                                                                |
| `pnpm verify`                                              | full quality gate                                                                                                   |
| `pnpm rename-project <kebab-name> ["Title"]`               | rename a new project: `package.json`, `APP_NAME` (problem URNs), Swagger title, compose names, Windows service name |
| `pnpm typecheck` / `lint` / `lint:test` / `check:circular` | individual checks                                                                                                   |
| `pnpm test` / `test:e2e` / `test:cov` / `test:oracle`      | tests (`test:oracle` needs a database)                                                                              |
| `pnpm test:service-scripts`                                | check the Windows service scripts in a PowerShell container (needs Docker)                                          |
| `docker compose --env-file .env.docker up --build`         | API + Oracle locally ([Operations](docs/architecture/operations.md#docker))                                         |
| `.\start-service.ps1` / `.\stop-service.ps1`               | Windows service via NSSM ([Operations](docs/architecture/operations.md#windows-service-nssm))                       |
