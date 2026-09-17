# 0001. Ports live with their callers

- Status: Accepted
- Date: 2026-09-17

## Context

The first project built from this template (atoll-delete-tool) put DAO interfaces in `infrastructure/database/dao-ports`. Use cases then imported infrastructure, driver types (`Lob`, `DBError`) leaked into application code, and module cycles needed `forwardRef`.

## Decision

- An interface lives in the layer that **calls** it:
    - aggregate repositories in `src/domain/repositories`
    - query and gateway ports in `src/application/ports`
    - infrastructure-only contracts (`ConnectionProvider`) in infrastructure
- Implementations always live in infrastructure.
- `AppModule` is the only composition root; infrastructure modules that provide ports are `@Global`.
- ESLint `no-restricted-imports` forbids application/domain importing outer layers or drivers; `madge` forbids cycles.

## Consequences

- Use cases can be tested with in-memory fakes and never change when storage changes.
- More files per feature (port + adapter + mapper) than calling SQL from a service.
- Adding a feature means touching several folders; the guides and the `add-feature` agent skill list them.
