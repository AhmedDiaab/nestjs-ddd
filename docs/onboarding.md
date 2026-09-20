# Onboarding

For someone who is new to NestJS, new to layered/DDD code, or new to this template specifically.

This is the one document that is a **path**, not a reference. Everything else in [`docs/`](README.md)
answers "how do I do X" and assumes you already know what X is. Read this first, once; after that the
task table in [the docs index](README.md) is the thing you keep open.

## 1. Before you touch the code

All free, in this order. About a day in total, and you do not need to finish it before writing code.

| Read                                                                                                                                | Why it matters here                                                                                                               | Time |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---- |
| [NestJS: Providers, Modules](https://docs.nestjs.com), then Fundamentals → Custom providers                                         | This template binds everything through custom providers and typed tokens, never by class name                                     | 2h   |
| [NestJS: Guards, Interceptors, Pipes, Exception filters](https://docs.nestjs.com)                                                   | Authentication, the response envelope, validation and error mapping are all built from these four                                 | 1h   |
| [Hexagonal architecture](https://alistair.cockburn.us/hexagonal-architecture/) (Cockburn, the original)                             | This is literally the shape of `application/ports` + `infrastructure`                                                             | 30m  |
| [DDD Reference](https://www.domainlanguage.com/ddd/reference/) (Evans, free PDF)                                                    | Definitions of entity, value object, aggregate, repository, domain event — the vocabulary `src/domain` uses                       | 2h   |
| [Zod](https://zod.dev)                                                                                                              | Both request validation and configuration are Zod schemas                                                                         | 1h   |
| [DDD and CQRS patterns](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/) (free) | A worked layered example. The code is C#; read the shapes, ignore the syntax                                                      | 2h   |
| [Strangler fig](https://martinfowler.com/bliki/StranglerFigApplication.html)                                                        | Only if you are migrating an existing service — it is the model behind [the legacy forwarder](guides/migrate-a-legacy-service.md) | 20m  |

Skip the TypeORM and Mongoose chapters of the Nest docs entirely. This template uses neither.

## 2. If you already know Nest, read this table first

Most of the friction is not learning Nest. It is that this template **forbids things Nest tutorials
teach**, for reasons that are deliberate and written down. If something you learned elsewhere does
not compile here, it is probably on this list.

| A Nest tutorial teaches                         | Here                                                                    | Why                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Inject a service by its class                   | Inject a **port** through a typed token                                 | A layer may not import an adapter; a wrong binding fails to compile ([0002](decisions/0002-typed-di-tokens.md)) |
| `throw new HttpException(...)` from a service   | `return this.err(new SomeError())`, a `Result`                          | Domain and application know nothing about HTTP ([0004](decisions/0004-result-errors-to-http-status.md))         |
| The ORM entity is the model                     | A domain entity is not a database row; mappers live in `infrastructure` | Persistence must not shape the domain                                                                           |
| `Scope.REQUEST` for per-request state           | Banned. Every provider is a singleton                                   | [0006](decisions/0006-singleton-providers.md) — request state travels as arguments                              |
| Business logic in a controller or a fat service | One **use case** class per intention                                    | A controller validates, calls one use case, returns its `Result`                                                |
| `process.env.SOMETHING`                         | `config.get('http.port')`                                               | Typed, validated at boot, fails fast without printing secrets                                                   |
| `export *` from an index file                   | Named exports only                                                      | [0007](decisions/0007-named-barrel-exports.md)                                                                  |
| Several classes in one file                     | One thing per file                                                      | [0008](decisions/0008-one-thing-per-file.md)                                                                    |

All eight are enforced by ESLint, `madge` or the specs in `test/unit/layers/` — you will be told,
not left to guess.

## 3. Your first day in the repo

1. `pnpm install`, then `pnpm verify`. It should be green before you change anything. If it is not,
   that is a bug worth reporting, not something you caused.
2. Read [Architecture overview](architecture/overview.md) — the four layers and what may import what.
3. Read the [Glossary](glossary.md). It is short, and it settles the words this codebase argues
   about most: repository vs DAO vs gateway, read model, unit of work.
4. Follow one request end to end in the code: `src/interface/http/controllers/database-info.controller.ts`
   → its use case in `src/application/use-cases` → the query port it depends on → the DAO in
   `src/infrastructure/database/queries` that implements it. That one trace explains the whole shape.
5. Skim [Dependency injection](architecture/dependency-injection.md) to see how those four files are
   wired together.

## 4. Your first feature

Work through [the feature walkthrough](guides/feature-walkthrough.md). It builds one feature across
every layer, in order, with the code. When you get stuck on a specific step, the task table in
[the docs index](README.md) has a focused guide for each one — adding an entity, a repository, a use
case, a controller, an error, a config variable.

Two rules that will save you a review round:

- **Tests are Arrange-Act-Assert**, with those comments and one Act per test ([write tests](guides/write-tests.md)).
- **Commits are [Conventional Commits](../CONTRIBUTING.md)** and the message is checked by a git hook
  before it lands.

## 5. The example feature

The `example/tickets` branch carries a complete feature — domain, repository, use cases, controller,
tests — built on this template:

```bash
git diff main...example/tickets
```

**It is behind `main`.** It still shows the right shapes, which is what it is for, but some APIs have
moved since it was written, so read it to learn the structure and trust `main` for exact names.

## 6. Where everything else lives

- [Docs index](README.md) — the "I want to…" task table. Your day-to-day entry point.
- [Decisions](decisions/README.md) — why the rules are what they are. Read one when a rule annoys you.
- [Known gaps](known-gaps.md) — what this template does not do, honestly. Read before assuming something is missing by accident.
- [`AGENTS.md`](../AGENTS.md) — the same rules, written for AI coding agents. Useful to humans as a dense summary.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — setup, the verify gate, commit conventions, releases.
