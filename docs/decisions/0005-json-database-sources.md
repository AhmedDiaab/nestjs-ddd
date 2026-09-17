# 0005. Database sources configured as JSON; dialect placeholders kept

- Status: Accepted
- Date: 2026-09-17

## Context

Services need several databases with many per-pool settings. Prefixed env vars (`DB_MAIN_POOL_MAX`…) were considered. atoll-delete-tool already used a JSON array (`DATABASE_CONFIG_JSON`).

## Decision

- Keep JSON sources (atoll-compatible), validated by a Zod discriminated union on `dialect`, with typed Oracle options and defaults.
- Secrets can be referenced with `passwordEnv` / `walletPasswordEnv` instead of embedded.
- Keep `postgres`, `mysql`, `mariadb`, `mssql`, `sqlite` as schema-validated placeholders backed by `NotImplementedClient`, so future integrations only add a client.

## Consequences

- One variable describes all sources; it must be single-quoted in `.env` files.
- Placeholders are skipped by boot pings unless marked required.
- `ConnectionOptions.username` is kept as a deprecated alias for atoll DAOs.
