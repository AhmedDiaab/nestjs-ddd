# Nestjs Domain Driven Design

NestJS 11 starter template for layered / DDD HTTP services: consistent response envelope, structured logging, fail-fast config, multi-source database layer (Oracle implemented), JWT verification, enforced layer boundaries, and an agent-ready setup.

## Highlights

- **Layered architecture** (interface → application → domain, infrastructure behind ports), enforced by ESLint, `madge` and typed DI tokens.
- **Database layer:** multiple sources configured as JSON; Oracle (node-oracledb, thin or thick) with full pool tuning, boot pings, readiness probe and graceful drain. Placeholders for other dialects.
- **Context user per query:** the end user is Oracle's `CLIENT_IDENTIFIER` for one call and is cleared before the connection returns to the pool.
- **Errors as values:** `Result` failures map to real HTTP statuses by problem kind; internals never leak to clients.
- **HTTP:** Zod validation (Express 5 safe), JWT (cookie or bearer), Swagger (off in production), helmet, CORS allow-list, rate limiting.
- **Operations:** structured pino logs with rotation, `/health` and `/health/ready` for monitors, Windows service scripts (NSSM).
- **Agent-ready:** `AGENTS.md`, Claude Code skills, a reviewer subagent, and a single `pnpm verify` gate.

## Quick start

```bash
pnpm install
cp .env.example .env.development   # set NODE_ENV=development and JWT_SECRET (≥ 32 chars)
pnpm start:dev                      # http://localhost:3000/v1, docs at /docs, health at /health
pnpm verify                         # typecheck, lint, cycles, unit + e2e tests, build
```

Requires Node.js ≥ 22.18 and pnpm 10. With `DATABASE_CONFIG_JSON` unset, the app runs without a database.

## Documentation

**[docs/README.md](docs/README.md)** routes you to the right document:

- [Architecture overview](docs/architecture/overview.md): layers, rules, folder map, request lifecycle
- [Feature walkthrough](docs/guides/feature-walkthrough.md): build a feature end to end, with step-by-step guides
- [Database](docs/architecture/database.md) · [Configuration](docs/architecture/configuration.md) · [HTTP interface](docs/architecture/http-interface.md) · [Testing](docs/architecture/testing.md) · [Operations](docs/architecture/operations.md)
- [Decisions](docs/decisions/README.md): why things are the way they are
- [Agentic development](docs/agentic-development.md) and [`AGENTS.md`](AGENTS.md): working with AI coding agents

## Scripts

| Script                                                     | Purpose                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm start:dev` / `start:debug` / `start:repl`            | local development                                                                             |
| `pnpm build` / `start:prod`                                | production build / run (`NODE_ENV` from environment)                                          |
| `pnpm verify`                                              | full quality gate                                                                             |
| `pnpm typecheck` / `lint` / `lint:test` / `check:circular` | individual checks                                                                             |
| `pnpm test` / `test:e2e` / `test:cov`                      | tests                                                                                         |
| `.\start-service.ps1` / `.\stop-service.ps1`               | Windows service via NSSM ([Operations](docs/architecture/operations.md#windows-service-nssm)) |
