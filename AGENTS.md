# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, …) working in this repository. Humans: see [`docs/README.md`](docs/README.md).

## Project

NestJS 11 layered/DDD API template: TypeScript 5 (strict), Express 5, Zod 4, node-oracledb 6, nestjs-pino, Jest 30, pnpm 10, Node ≥ 22.18.

## Commands

| Goal                                                    | Command                                                  |
| ------------------------------------------------------- | -------------------------------------------------------- |
| Install                                                 | `pnpm install`                                           |
| Rename a project created from this template             | `pnpm rename-project <kebab-name> ["Title"]`             |
| **Done check (run before claiming a task is complete)** | `pnpm verify`                                            |
| Type-check src + test                                   | `pnpm typecheck`                                         |
| Lint                                                    | `pnpm lint` (src), `pnpm lint:test` (test)               |
| Import cycles                                           | `pnpm check:circular`                                    |
| Unit tests / one file                                   | `pnpm test` / `pnpm exec jest test/unit/path/to.spec.ts` |
| E2E tests                                               | `pnpm test:e2e`                                          |
| Live Oracle tests (needs a DB)                          | `ORACLE_IT_PASSWORD=… pnpm test:oracle`                  |
| Windows service scripts (needs Docker)                  | `pnpm test:service-scripts`                              |
| Build                                                   | `pnpm build`                                             |
| Run locally                                             | `pnpm start:dev` (needs `.env.development`)              |
| Run with Docker (API + Oracle)                          | `docker compose --env-file .env.docker up --build`       |

Jest does **not** type-check; `pnpm typecheck` does. `pnpm verify` runs everything.

## Architecture rules (enforced; don't work around them)

```
interface → application → domain        infrastructure implements ports
```

| Layer          | Path                 | Put here                                                                                         | Never import                                                 |
| -------------- | -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Domain         | `src/domain`         | entities, value objects, aggregates, domain errors, **aggregate repository interfaces + tokens** | `@application`, `@infrastructure`, `@interface`, `@nestjs/*` |
| Application    | `src/application`    | use cases, **query/gateway ports + tokens**, application errors                                  | `@infrastructure`, `@interface`, `oracledb`, `express`       |
| Infrastructure | `src/infrastructure` | config, logging, auth, DB clients, repositories, DAOs, mappers                                   | `@interface`                                                 |
| Interface      | `src/interface/http` | controllers, Zod schemas, guards, interceptors, filter                                           | adapter internals (tokens/contracts only)                    |

- A port lives with the layer that **calls** it; its implementation lives in infrastructure.
- Tokens: `createToken<Port>('Name')` from `@shared`. Bind with `ProviderFactory.class|factory|value` (typed; wrong bindings don't compile).
- DAOs/repositories take `ConnectionProvider` via `ProviderFactory.factory(Token, (db) => new Dao(db), [ConnectionProviderToken])` in `database.module.ts`.
- `AppModule` is the only composition root. `ApplicationModule` must not import infrastructure.
- All providers are singletons. Never use `Scope.REQUEST`.

Details: [`docs/architecture/overview.md`](docs/architecture/overview.md).

## Conventions

- **Use cases** extend `UseCase<Input, Output, Failure>`. Expected failures: `return this.err(new SomeError())` (an `AppError`/`DomainError` whose problem kind maps to the HTTP status). Unexpected: throw. Never throw `HttpException` from application/domain.
- **Controllers** only validate (`@UseZodHttp` + `@Validated('body'|'query'|'params')`), read `@CurrentUser()`, call one use case, and return its `Result`. Register them in `interface.module.ts` **before** `FallbackController`.
- **Never assign `req.query`** (read-only in Express 5). Use `@Validated('query')`.
- **Guards** run before validation: use `readGuardInput(context, part, schema)` and throw `ForbiddenError`/`UnauthorizedError`; don't `return false`.
- **Database access**:
    - always bind values (`:name`); never interpolate input into SQL
    - `ORDER BY` from a whitelist map
    - avoid keyword bind names (`:offset`, `:fetch`, `:size`, `:date`)
    - `outFormat: oracledb.OUT_FORMAT_OBJECT` + named columns; map rows in `infrastructure/database/mappers`, never in domain
    - writes inside `db.transaction(...)`; several aggregates atomically → `UnitOfWorkPort.run(...)` in the use case, never connections in use cases
    - pass `{ contextUser: options?.actor, tag: 'feature.method' }` on every call
- **Domain events**: aggregates `addEvent`; use cases `publish(aggregate.pullEvents())` via `DomainEventPublisherPortToken` **after** the save/unit of work commits; handlers implement `DomainEventHandler` in `src/application/events` and are listed in `ApplicationModule`.
- **Actor**: controllers pass `user.username` → use case input `username` → port option `actor` → adapter `contextUser` (Oracle `CLIENT_IDENTIFIER`).
- **Config**: new env vars go through a Zod schema + `envString`/`envBool`/`envList` in `load-config.ts`, `.env.example`, and `docs/architecture/configuration.md`. Read via `ConfigPortToken`.
- **Logging**: inject `LoggerPortToken`; dotted event names (`tickets.close.rejected`) + meta object. Never log secrets, tokens, bind values or unnecessary personal data.
- **Errors to clients** expose `message`/`code`/`type` only; put diagnostics in `details` (logs only).
- **One thing per file**: one class, decorator, pipe, handler or helper per file, named after it (`csrf-rejected.error.ts`, `zod-response.decorator.ts`, `format-zod-error.util.ts`). Never declare a second class (e.g. an error) inside another class's file; ESLint `max-classes-per-file` rejects it. Allowed together: a port + its token + its types, a schema + its inferred type, small pure helpers of one topic in one `*.util.ts`, constants of one area. See [decision 0008](docs/decisions/0008-one-thing-per-file.md).
- **Style**: Prettier (4 spaces, single quotes, width 100), `import type` for types, barrel `index.ts` per folder with **named exports only** (`export { Foo, type Bar } from './foo'`; `export *` is a lint error, see [decision 0007](docs/decisions/0007-named-barrel-exports.md)), file names `kebab-case.<kind>.ts` (`*.use-case.ts`, `*.controller.ts`, `*.dao.ts`, `*.repository.ts`, `*.error.ts`, `*.vo.ts`, `*.entity.ts`, `*.schema.ts`, `*.port.ts`).
- **Tests** mirror `src` under `test/unit`; fakes in `test/fakes`; HTTP flows in `test/e2e` with `.overrideProvider(Token).useValue(fake)`.
- **Test structure**: Arrange-Act-Assert in every test, with `// Arrange`, `// Act`, `// Assert` comments and a blank line between sections; one Act per test ([guide](docs/guides/write-tests.md)).

## How to do common tasks

Follow the matching guide; each has complete, compiled example code:

| Task                               | Guide                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New feature end to end             | [`docs/guides/feature-walkthrough.md`](docs/guides/feature-walkthrough.md)                                                                               |
| Entity / value object              | [`docs/guides/add-value-object-and-entity.md`](docs/guides/add-value-object-and-entity.md)                                                               |
| Repository (aggregate persistence) | [`docs/guides/add-repository.md`](docs/guides/add-repository.md)                                                                                         |
| Query port + DAO (reads)           | [`docs/guides/add-query-port-and-dao.md`](docs/guides/add-query-port-and-dao.md)                                                                         |
| Use case                           | [`docs/guides/add-use-case.md`](docs/guides/add-use-case.md)                                                                                             |
| Controller / endpoint              | [`docs/guides/add-controller.md`](docs/guides/add-controller.md)                                                                                         |
| Error → HTTP status                | [`docs/guides/add-error.md`](docs/guides/add-error.md)                                                                                                   |
| Config variable                    | [`docs/guides/add-config-variable.md`](docs/guides/add-config-variable.md)                                                                               |
| Database source / dialect          | [`docs/guides/add-database-source.md`](docs/guides/add-database-source.md), [`docs/guides/add-database-dialect.md`](docs/guides/add-database-dialect.md) |
| Tests                              | [`docs/guides/write-tests.md`](docs/guides/write-tests.md)                                                                                               |

Before changing a documented decision, read [`docs/decisions/`](docs/decisions/README.md) and add a new record if you reverse one.

## Boundaries

- **Don't** read, print or commit `.env*` files other than `.env.example`; never put secrets in code, tests, logs or docs.
- **Don't** weaken lint rules, `strict` TypeScript, or the layer restrictions to make a change pass. Fix the design instead.
- **Don't** edit `pnpm-lock.yaml` by hand; add dependencies with `pnpm add` and justify them.
- **Don't** remove the context-user clear/drop logic in `OracleClient` or bypass `ConnectionProvider` from use cases.
- **Ask first** before: changing public HTTP response shapes, DB schema/migrations, auth/JWT verification, CORS/helmet/throttling defaults, or the Windows service scripts.
- Update the relevant `docs/` page in the same change when behaviour, configuration or conventions change.

## Definition of done

1. `pnpm verify` passes, with no new lint suppressions.
2. Tests were added or updated for new behaviour, including failure paths and HTTP statuses.
3. Docs/`.env.example` updated if config, endpoints or conventions changed.
4. Commits follow Conventional Commits (`feat(scope): …`, `fix(scope): …`), with a body explaining _why_ for fixes.
