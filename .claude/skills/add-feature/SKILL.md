---
name: add-feature
description: Scaffold a new business feature across domain, application, infrastructure and HTTP layers of this NestJS DDD template (entity/value objects, repository or query port, use cases, Oracle adapter, controller, tests). Use when asked to add a feature, endpoint backed by the database, aggregate, or CRUD-like capability.
---

# Add a feature

Follow `docs/guides/feature-walkthrough.md`; each step links to a guide with compiled example code. The `example/tickets` branch holds the full reference implementation (`git show example/tickets:<path>`).

## 1. Clarify (ask only what you can't infer)

- The nouns (aggregate name, fields, ids) and verbs (use cases).
- Rules and failure cases, and which HTTP status each should produce.
- Which operations change state (repository) vs only read (query port).
- Database table/columns and source key (default `main`). Don't invent schemas silently; propose DDL and confirm.

## 2. Plan the files

List every file before writing. Typical set for feature `<name>`:

```
src/domain/<name>/<field>.vo.ts, <name>.errors.ts, <name>.entity.ts, index.ts
src/domain/repositories/<name>.repository.ts            (+ export in index.ts)
src/application/ports/queries/<name>.query.port.ts      (+ exports)
src/application/use-cases/<name>/<verb>-<name>.use-case.ts (+ index.ts, ApplicationModule)
src/infrastructure/database/mappers/<name>.mapper.ts
src/infrastructure/database/repositories/oracle-<name>.repository.ts
src/infrastructure/database/queries/<name>-query.dao.ts
src/infrastructure/database/database.module.ts          (bindings + exports)
src/interface/http/schemas/<name>.schema.ts             (+ index.ts)
src/interface/http/controllers/<name>.controller.ts     (+ index.ts, InterfaceModule before FallbackController)
test/fakes/in-memory-<name>.ts
test/unit/domain/<name>/*.spec.ts
test/unit/application/use-cases/<name>/*.spec.ts
test/unit/infrastructure/database/{repositories,queries}/*.spec.ts
test/e2e/<name>.e2e-spec.ts
```

Skip what the feature doesn't need (e.g. read-only features need no aggregate or repository).

## 3. Build inside-out

Domain → ports → use cases → adapters → HTTP → tests. After each layer run `pnpm typecheck` to catch mistakes early.

## 4. Hard rules

- Domain imports only `@shared` and domain files. Use cases inject ports by token and return `Result` for expected failures.
- SQL:
    - binds only
    - whitelist `ORDER BY`
    - no keyword bind names (`:offset`, `:fetch`, `:size`)
    - `OUT_FORMAT_OBJECT`
    - writes in `transaction`
    - `{ contextUser: options?.actor, tag }` on every call
- Controllers: `@UseZodHttp` + `@Validated`, pass `user.username`, return the use-case result.
- Tokens via `createToken<Port>()`; bindings via `ProviderFactory`.
- Barrels: named exports only (`export { Foo, type Bar } from './foo'`), never `export *`.
- Tests: Arrange-Act-Assert with `// Arrange`, `// Act`, `// Assert` comments, one Act per test.

## 5. Finish

- Run the `verify` skill (`pnpm verify`) until green.
- Ask the `architecture-reviewer` subagent to review the diff; fix what it finds.
- Document new config in `.env.example` and `docs/architecture/configuration.md`; new endpoints in Swagger decorators.
