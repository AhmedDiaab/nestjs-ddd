# Glossary

What each term means **in this codebase**, and when to reach for it. Other projects use some of these words differently; this page wins here.

## Pick the right piece

Start from what the request does, not from the database:

| The request…                                                     | Build                                                    | Example                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| reads data to show it (list, detail, report, export)             | **query port** + **DAO** (returns a **read model**)      | `GET /v1/tickets`                         |
| changes data and **your code** decides whether it's allowed      | **aggregate** + **repository port** + repository adapter | close a ticket (it can't be closed twice) |
| changes data through **another team's procedure**, which decides | **gateway port** + gateway adapter                       | `account_api.suspend_account`             |
| talks to something that isn't a database (mail, queue, HTTP API) | **gateway port** + adapter                               | send a notification                       |
| needs several writes to succeed or fail together                 | the above + **unit of work**                             | close 5 tickets at once                   |

Every one of them is called by a **use case**, which the **controller** calls. Everything crossing a layer goes through a **port** bound to a **token**.

## Layers

| Term                | Means here                                                                                       | Folder                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| **Domain**          | business rules that would still exist without HTTP or a database                                 | `src/domain`                                    |
| **Application**     | one class per user intention (use cases) plus the ports they need                                | `src/application`                               |
| **Infrastructure**  | everything that talks to the outside: config, logging, auth, database adapters                   | `src/infrastructure`                            |
| **Interface**       | delivery: HTTP (controllers, validation, guards, interceptors, error mapping) and scheduled jobs | `src/interface/http`, `src/interface/scheduler` |
| **Shared / common** | framework-free helpers (`Result`, problem kinds, envelope, tokens) and Nest helpers              | `src/shared`, `src/common`                      |

Dependencies point inward: interface → application → domain. Infrastructure implements ports and is wired in `AppModule`, the **composition root**.

## Building blocks

| Term                  | Means here                                                                           | Rules of thumb                                           |
| --------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| **Entity**            | object with an identity that changes over time                                       | equality by id, not by fields                            |
| **Value object (VO)** | value defined only by its contents, validated on creation (`TicketTitle`)            | immutable, `create()` returns `Result`, compare by value |
| **Aggregate root**    | entity that owns a consistency boundary; the only thing a repository loads and saves | keep small: one aggregate per transaction where possible |
| **Domain event**      | something that happened, recorded by an aggregate (`TicketClosed`)                   | published by the use case **after** the write commits    |
| **Domain error**      | a rule refused the operation (`TicketAlreadyClosedError`)                            | maps to an HTTP status through its problem kind          |
| **Read model**        | plain data shaped for a response (`TicketSummary`)                                   | JSON-safe: ISO date strings, `null`, no class instances  |
| **Row type**          | the database's column layout (`TICKET_ID`, `STATUS_CODE`)                            | infrastructure only, never in domain or application      |
| **Mapper**            | translates row ↔ aggregate / read model                                             | the only place that knows column names and codes         |

## Ports and adapters

A **port** is an interface the inner layers depend on. An **adapter** is the infrastructure class implementing it. They meet at a **token**.

| Term                        | What it is                                                                                 | Lives in                               | Returns                              |
| --------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------ |
| **Repository port**         | load and save one aggregate (`findById`, `save`, `nextId`)                                 | `src/domain/repositories`              | aggregates, `undefined` when missing |
| **Repository (adapter)**    | SQL for that aggregate, with a mapper                                                      | `infrastructure/database/repositories` | —                                    |
| **Query port**              | reads for responses (`listByStatus`, `findById`)                                           | `application/ports/queries`            | read models, `PageEnvelope`          |
| **DAO**                     | the SQL behind a query port (Data Access Object)                                           | `infrastructure/database/queries`      | —                                    |
| **Gateway port**            | an action someone else performs for us: their stored procedure, a mail server, another API | `application/ports/gateways`           | `Result` with expected refusals      |
| **Gateway (adapter)**       | the call itself (procedure, SMTP, HTTP)                                                    | `infrastructure/...`                   | —                                    |
| **Cross-cutting port**      | `ConfigPort`, `LoggerPort`, `DomainEventPublisherPort`, `UnitOfWorkPort`                   | `application/ports`                    | —                                    |
| **Infra-internal contract** | `ConnectionProvider`: pools, connections, transactions                                     | `infrastructure/database/contracts`    | —                                    |

**Repository vs DAO vs gateway** is the question people ask most:

- **Repository**: you own the rules and the aggregate. It speaks domain types only. One per aggregate.
- **DAO / query port**: you only read. It speaks read models, may join tables, and skips the domain entirely.
- **Gateway**: someone else does the work and enforces the rules; you send a command and translate the answer.

A repository is not "any class with SQL": a read-only list belongs in a DAO even when it queries the aggregate's table.

## Application

| Term                       | Means here                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Use case**               | one class per intention (`CloseTicketUseCase`), extends `UseCase<Input, Output, Failure>`, `execute()` returns a `Result`. Controllers call exactly one |
| **Input / Output**         | plain types of that use case; no HTTP or driver types                                                                                                   |
| **Failure union**          | the expected errors, listed in the type so tests and readers see them                                                                                   |
| **Application error**      | expected failure not tied to domain rules: `NotFoundError`, `ConflictError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`                   |
| **Result**                 | `{ ok: true, value }` or `{ ok: false, error }`. Expected failures are returned; the unexpected is thrown                                               |
| **Unit of work**           | runs several repository/gateway calls in one transaction; commits once, rolls back on a throw or a failed `Result`                                      |
| **Domain event publisher** | hands events to handlers after the commit                                                                                                               |
| **Actor**                  | the acting username, passed use case → port option `actor` → adapter `contextUser`                                                                      |

## Interface (HTTP)

| Term              | Means here                                                                                                 |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| **Controller**    | validates, reads the user, calls one use case, returns its `Result`                                        |
| **Envelope**      | the response shape every route produces: `{ success, data, meta }` or `{ success: false, error, meta }`    |
| **Interceptor**   | wraps requests/responses: Zod validation (`ZodHttpInterceptor`), envelope (`ResponseFormatterInterceptor`) |
| **Guard**         | allows or refuses a request before validation: `JwtGuard`, `CsrfGuard`, `ThrottlerGuard`                   |
| **`@Public()`**   | marks a handler or controller as reachable without authentication; everything else needs a token           |
| **`@Roles()`**    | names the roles a route needs from the token; `RolesGuard` refuses the rest with 403                       |
| **Filter**        | turns anything thrown into an envelope with the right status (`GlobalExceptionFilter`)                     |
| **Problem kind**  | semantic failure type (`not_found`, `conflict`, `validation`…) that `ErrorPresenter` maps to a status      |
| **Schema**        | Zod schema per request part; also generates the Swagger docs                                               |
| **Scheduled job** | a class that runs on a cron expression and calls a use case; a delivery mechanism like a controller        |

## Infrastructure and runtime

| Term                    | Means here                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| **Source / source key** | one configured database (`main`), defined in `DATABASE_CONFIG_JSON`, referenced through `DatabaseSources` |
| **Pool**                | the driver's connection pool for a source; `PoolManager` owns one per source                              |
| **ConnectionProvider**  | how adapters get a connection: `withConnection`, `transaction`, `runInTransaction`                        |
| **HttpClient**          | infrastructure contract for one outbound call: timeout, retries, circuit breaker, correlation header      |
| **Circuit breaker**     | stops calling an upstream that keeps failing, then lets one trial call through                            |
| **Request context**     | the correlation id and trace of the current request, carried through async calls (`RequestContextPort`)   |
| **Trace id / span id**  | W3C Trace Context: one id shared by every service handling a request, and this service's part of it       |
| **Metric labels**       | the dimensions of a metric; bounded values only (route templates, tags), never ids or URLs                |
| **Context user**        | the acting username sent to Oracle as `CLIENT_IDENTIFIER` for one call, then cleared                      |
| **Draining**            | the window after SIGTERM where readiness fails but the instance still serves what it already accepted     |
| **Tag**                 | a label like `tickets.save` attached to a call for logs and errors, never the SQL text                    |
| **Dialect**             | database type of a source (`oracle` implemented; others are placeholders)                                 |

## Wiring and conventions

| Term                 | Means here                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| **Token**            | `createToken<Port>('Name')`: the typed key a port is injected by; a wrong binding fails to compile |
| **ProviderFactory**  | builds Nest providers (`class`, `factory`, `value`, `existing`) for tokens                         |
| **Composition root** | `AppModule`, the only place layers are wired together                                              |
| **Barrel**           | a folder's `index.ts` listing its named exports (no `export *`)                                    |
| **Fake**             | hand-written in-memory implementation of a port, used in tests (`InMemoryTickets`)                 |
| **Fixture**          | reusable test data or helper (`test/fixtures`)                                                     |
| **Verify**           | `pnpm verify`: typecheck, lint, cycles, unit + e2e tests, build. The done check                    |

## Where to read more

- Layers and rules: [Architecture overview](architecture/overview.md)
- Ports, tokens, placement: [Dependency injection](architecture/dependency-injection.md)
- Domain building blocks: [Domain layer](architecture/domain-layer.md)
- Use cases, `Result`, errors: [Application layer](architecture/application-layer.md)
- HTTP envelope, guards, statuses: [HTTP interface](architecture/http-interface.md)
- Sources, pools, transactions: [Database](architecture/database.md)
- Why the rules exist: [Decisions](decisions/README.md)
