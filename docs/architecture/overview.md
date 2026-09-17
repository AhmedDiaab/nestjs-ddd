# Architecture overview

NestJS 11 template with a layered / DDD structure. Business rules sit in the middle; frameworks, databases and HTTP sit at the edges and depend inward.

## Layers

```
interface  ──►  application  ──►  domain
                    ▲                ▲
infrastructure ─────┴────────────────┘   (implements ports)

common, shared: helpers usable by every layer (shared is framework-free)
```

| Layer          | Folder               | Contains                                                                                  | May import                                                                  | Must not import                                                     |
| -------------- | -------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Domain         | `src/domain`         | entities, value objects, aggregates, domain errors, **repository interfaces**             | `@shared`, itself                                                           | `@application`, `@infrastructure`, `@interface`, `@nestjs/*`        |
| Application    | `src/application`    | use cases, **query/gateway ports**, DI tokens, application errors                         | `@domain`, `@common`, `@shared`, `@nestjs/common` (DI decorators)           | `@infrastructure`, `@interface`, `oracledb`, `express`, `passport*` |
| Infrastructure | `src/infrastructure` | adapters: config, logging, auth strategy, database (pools, clients, repositories, DAOs)   | `@application`, `@domain`, `@common`, `@shared`, drivers                    | `@interface`                                                        |
| Interface      | `src/interface`      | controllers, guards, interceptors, exception filter, Zod schemas, Swagger                 | `@application`, `@domain`, `@common`, `@shared`, infra **tokens/contracts** | adapter internals                                                   |
| Common         | `src/common`         | Nest-aware helpers: `ProviderFactory`, `UseCase` base, utils                              | `@shared`, `@nestjs/common`                                                 | layers                                                              |
| Shared         | `src/shared`         | framework-free primitives: `Result`, `Problem`, envelope types, pagination, `createToken` | nothing app-specific                                                        | everything else                                                     |

Enforcement:

- **ESLint** `no-restricted-imports` blocks the application and domain violations above (`eslint.config.mjs`).
- **madge**: `pnpm check:circular` fails on import cycles.
- **Layer tests**: `test/unit/layers/*` check module wiring.

## Folder map

```text
src/
├── main.ts                 # bootstrap: logger, helmet, body limits, CORS, versioning, Swagger
├── app.module.ts           # composition root: imports Infrastructure, Application, Interface modules
├── domain/
│   ├── base/               # Entity, ValueObject, AggregateRoot, DomainEvent
│   ├── errors/             # DomainError, ValidationError, AggregateNotFoundError
│   ├── repositories/       # aggregate repository interfaces + tokens (added per feature)
│   └── auth/               # JWTPayload
├── application/
│   ├── ports/              # ConfigPort, LoggerPort, query/gateway ports, tokens.ts
│   ├── use-cases/          # one class per use case
│   ├── errors/             # AppError + NotFound/Conflict/BadRequest/Unauthorized/Forbidden/...
│   ├── contracts/          # paginated repository contracts
│   └── shared/             # LogMeta types
├── infrastructure/
│   ├── config/             # env → Zod schemas → EnvConfigAdapter (ConfigPort)
│   ├── logging/            # nestjs-pino setup, PinoLoggerAdapter (LoggerPort)
│   ├── auth/               # JwtStrategy
│   └── database/
│       ├── clients/        # DatabaseClient, OracleClient, NotImplementedClient, oracle/ helpers
│       ├── connection/     # PoolManager, ConnectionProvider factory + token
│       ├── contracts/      # ConnectionProvider interface (infra-internal port)
│       ├── queries/        # query DAOs (example: DatabaseInfoQueryDao)
│       ├── errors/         # DatabaseConnectionError, DatabaseExecutionError, ...
│       ├── types/ utils/
│       ├── sources.ts      # source keys used by DAOs/repositories
│       └── database.module.ts
├── interface/http/
│   ├── controllers/        # HealthController, DatabaseInfoController
│   ├── common/             # FallbackController (404), ResponseFormatterInterceptor
│   ├── decorators/         # @UseZodHttp, @Validated, @CurrentUser
│   ├── errors/             # HTTP-only errors (CsrfRejectedError); business errors live in application/domain
│   ├── guards/             # JwtGuard, getAuthenticatedUser, readGuardInput, CsrfGuard
│   ├── interceptors/       # ZodHttpInterceptor
│   ├── pipes/ schemas/ swagger/
│   ├── error-presenter.ts  # problem kind → HTTP status
│   └── global-exception.filter.ts
├── common/                 # ProviderFactory, UseCase base, utils
└── shared/                 # Result, problem, envelope, pagination, typed tokens
test/
├── unit/                   # mirrors src/
├── e2e/                    # boots AppModule over HTTP
└── fixtures/
```

## Composition root

`AppModule` is the only place that wires layers together:

```ts
@Module({ imports: [InfrastructureModule, ApplicationModule, InterfaceModule], ... })
```

- `InfrastructureModule` imports `ConfigModule`, `PinoLoggerModule`, `DatabaseModule` (all `@Global`) and `AuthModule`. Global modules export port tokens, so use cases can inject them without importing infrastructure.
- `ApplicationModule` registers use cases only.
- `InterfaceModule` imports `ApplicationModule` and registers controllers, the throttler guard, interceptors and the exception filter. `FallbackController` must stay **last** in `controllers` (its catch-all route shadows later ones).

## Request lifecycle

1. **Express middleware**: helmet, cookie-parser, body parsers (size limits), CORS, pino-http (assigns `req.id` from `x-request-id` or a UUID).
2. **Guards**: `ThrottlerGuard` (global), then route guards such as `JwtGuard`. Guards run **before** validation.
3. **Interceptors**: `ZodHttpInterceptor` validates parts declared with `@UseZodHttp` (400 on failure); `ResponseFormatterInterceptor` wraps the result.
4. **Controller** → **use case** → **ports** → **adapters** (DAO/repository → `ConnectionProvider` → `OracleClient`).
5. **Response**: a plain value or `Result.ok` becomes `{ success: true, data, meta }`; `Result.err(error)` is rethrown.
6. **Errors**: `GlobalExceptionFilter` maps `HttpException`, body-parser errors and `AppError`/`DomainError` (by problem kind) to `{ success: false, error, meta }` with the right status, and logs 4xx/5xx.

See [Diagrams](diagrams.md) for sequence diagrams.

## Key conventions

- **Ports live with their caller**: aggregate repositories in `domain/repositories`, query/gateway ports in `application/ports`, infra-only contracts (`ConnectionProvider`) in infrastructure. See [Dependency injection](dependency-injection.md#where-ports-live).
- **Typed tokens**: `createToken<Port>('Name')`; `ProviderFactory` refuses mismatched bindings at compile time.
- **Expected failures are values**: return `Result.err(new SomeAppError())`; throw only for the unexpected. See [Application layer](application-layer.md).
- **Map rows in infrastructure**, never in domain; use `outFormat: OBJECT` and named columns.
- **Barrels use named exports**: each `index.ts` lists what it exposes (`export { Foo, type Bar } from './foo'`); `export *` fails lint. See [decision 0007](../decisions/0007-named-barrel-exports.md).
- **Pass the end user down** as `actor`/`contextUser` so Oracle sees it as `CLIENT_IDENTIFIER`.

## Related

- [Decisions](../decisions/README.md) explain why these rules exist.
- [Feature walkthrough](../guides/feature-walkthrough.md) applies them end to end.
