# Nestjs Domain Driven Design

Nestjs Domain Driven Design is a NestJS 11 starter template for building domain-driven HTTP services. It provides a consistent façade, end-to-end observability, runtime safeguards, and opinionated response envelopes while keeping the core domain isolated behind ports and adapters so it can integrate with any downstream platform.

## 1. Highlights

- Request-scoped structured logging with `nestjs-pino`, correlation IDs, and optional daily file rotation.
- Fail-fast configuration loader built on `dotenv-flow` plus Zod validation.
- Global HTTP formatting: all responses use a `{ success, data|error, meta }` envelope.
- Zod-powered validation for request bodies, params, query strings, and headers.
- Domain-driven layering (Interface → Application → Domain) reinforced by TypeScript path aliases.
- Developer conveniences: Nest REPL entry point, linting, formatting, and Jest unit/E2E suites.

## 2. Tech Stack

- Node.js ≥ 22.18 (`.nvmrc`)
- NestJS 11 with Express adapter
- TypeScript 5.7 (NodeNext modules)
- `nestjs-pino`, `pino`, `pino-roll`, `pino-pretty`
- `dotenv-flow` for layered env files
- `zod` for runtime validation
- pnpm 10 workspace tooling

## 3. Repository Layout

```text
.
├── .env.example
├── .env.development
├── docs/diagrams.drawio
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── src/
│   ├── app.controller.ts
│   ├── app.controller.spec.ts
│   ├── app.module.ts
│   ├── app.service.ts
│   ├── application/
│   ├── common/
│   ├── domain/
│   ├── infrastructure/
│   ├── interface/
│   ├── main.ts
│   ├── repl.ts
│   └── shared/
├── test/
│   ├── app.e2e-spec.ts
│   └── jest-e2e.json
└── tsconfig*.json
```

Generated directories such as `dist/` (build output) and `logs/` (runtime logs) are excluded from version control.

## 4. Architecture & Layering

- **Interface (`src/interface`)** exposes application use cases through HTTP controllers, interceptors, and filters. It never reaches into infrastructure implementations directly.
- **Application (`src/application`)** hosts use cases, ports (interfaces), and cross-cutting contracts. It coordinates domain logic and emits `Result` objects or typed errors.
- **Domain (`src/domain`)** contains pure business rules and domain-specific errors. No NestJS or infrastructure references appear here.
- **Infrastructure (`src/infrastructure`)** implements application ports (config, logging, future persistence) and registers adapters via DI tokens.
- **Shared (`src/shared`)** provides framework-agnostic primitives (Result, Problem, pagination, helpers).
- **Common (`src/common`)** collects light framework utilities such as DI factories, base use-case classes, and stack-trace formatting helpers.

Dependencies always point inward (Interface → Application → Domain). Infrastructure is wired through DI tokens so that core layers remain testable and framework-agnostic.

## 5. Source Modules

### 5.1 Entry & Sample Components

| File                         | Purpose                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`                | Bootstraps `AppModule`, hooks `nestjs-pino`, applies timeouts/body limits/CORS/versioning, and starts the HTTP server. |
| `src/app.module.ts`          | Root Nest module importing infrastructure and interface modules plus the sample controller/service.                    |
| `src/app.service.ts`         | Placeholder service returning `"Hello World!"`.                                                                        |
| `src/app.controller.ts`      | Sample controller exposing `GET /`.                                                                                    |
| `src/app.controller.spec.ts` | Unit test for the sample controller.                                                                                   |
| `src/repl.ts`                | Launches the Nest REPL with history support.                                                                           |

### 5.2 Interface Layer (`src/interface`)

| File                                                         | Description                                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `interface.module.ts`                                        | Registers global HTTP concerns (interceptors, filters) and the fallback controller.                         |
| `http/common/fallback/fallback.controller.ts`                | Throws an application `NotFoundError` for any unmatched route.                                              |
| `http/common/interceptors/response-formatter.interceptor.ts` | Wraps handler output (including `Result` objects) into a `{ success, data error, meta }`                    |
|                                                                envelope unless explicitly disabled                                                                         |
| `http/interceptors/zod-http.interceptor.ts`                  | Reads `@UseZodHttp` metadata and validates body/query/params/headers before the handler runs.               |
| `http/decorators/zod-http.decorator.ts`                      | Attaches Zod schemas to controllers or handlers.                                                            |
| `http/pipes/zod-validation.pipe.ts`                          | Standalone Zod validation pipe for ad-hoc use.                                                              |
| `http/schemas/pagination.schema.ts`                          | Common Zod schemas for offset/cursor pagination queries.                                                    |
| `http/error-presenter.ts`                                    | Converts `PresentableError` instances into Problem payloads with HTTP status codes.                         |
| `http/global-exception.filter.ts`                            | Catch-all filter that normalizes errors, merges metadata, and logs failures with stack traces when enabled. |

### 5.3 Application Layer (`src/application`)

| File                                | Description                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `ports/config.port.ts`              | Abstract configuration interface (dot-path getter, aggregation, environment check). |
| `ports/logger.port.ts`              | Structured logging contract shared across layers.                                   |
| `contracts/paginated-repository.ts` | Offset and cursor pagination repository contracts.                                  |
| `errors/app-error.ts`               | Base class for application errors implementing `PresentableError`.                  |
| `errors/bad-request-error.ts`       | HTTP 400-style application error.                                                   |
| `errors/not-found-error.ts`         | HTTP 404-style application error.                                                   |
| `errors/infrastructure-error.ts`    | Wraps downstream failures, mapping to service unavailability.                       |
| `errors/unexpected-error.ts`        | Generic internal error for unhandled cases.                                         |
| `shared/logging.ts`                 | Central log metadata typings to keep log structure consistent.                      |

### 5.4 Domain Layer (`src/domain`)

| File                         | Description                                                       |
| ---------------------------- | ----------------------------------------------------------------- |
| `errors/domain-error.ts`     | Base class for domain errors, defaulting to validation semantics. |
| `errors/not-found-error.ts`  | Domain-level “aggregate not found” error.                         |
| `errors/validation-error.ts` | Domain validation error with field-level details.                 |

### 5.5 Infrastructure Layer (`src/infrastructure`)

| File                           | Description                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `infrastructure.module.ts`     | Aggregates config and logging modules for import into `AppModule`.                                                               |
| `config/config.module.ts`      | Global provider binding `ConfigPortToken` to the environment adapter.                                                            |
| `config/config.token.ts`       | Symbol DI token for configuration access.                                                                                        |
| `config/env-config.adapter.ts` | Loads `.env*` files via `dotenv-flow`, validates with Zod, and exposes `ConfigPort`. Exits the process on invalid configuration. |
| `config/schemas/*.ts`          | Zod schemas for app/logging/http namespaces, providing sane defaults and type safety.                                            |
| `logging/pino.module.ts`       | Configures `nestjs-pino` with options derived from `ConfigPort`, exposing `LoggerPort`.                                          |
| `logging/pino.adapter.ts`      | Request-scoped adapter implementing `LoggerPort` using `PinoLogger`.                                                             |
| `logging/pino.options.ts`      | Generates Pino transports, correlation IDs, log redaction, and custom messages.                                                  |
| `logging/logging.token.ts`     | Symbol DI token for logger access.                                                                                               |

### 5.6 Common Utilities (`src/common`)

| File                               | Description                                                       |
| ---------------------------------- | ----------------------------------------------------------------- |
| `base/use-case.base.ts`            | Async use-case base class returning `Result` objects.             |
| `contracts/use-case.ts`            | Use-case interface aliases and DI token helper.                   |
| `factories/provider.factory.ts`    | Factory to bind tokens to classes without repetitive boilerplate. |
| `type-utils.ts`                    | Framework-aware DI typing helpers.                                |
| `utils/format-stack-trace.util.ts` | Trims stack traces for cleaner logging.                           |

### 5.7 Shared Utilities (`src/shared`)

| File                   | Description                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `result.ts`            | Lightweight `Result` implementation with helpers (`ok`, `err`, `map`, `combine`).      |
| `helpers.ts`           | Type guards for objects, envelopes, and `Result`-like shapes.                          |
| `problem.ts`           | Problem domain model, `PresentableError` contract, and type guards.                    |
| `response-envelope.ts` | Response envelope types, metadata shape, pagination alias, and `x-skip-format` header. |
| `pagination/types.ts`  | Core pagination request/response types.                                                |
| `pagination/cursor.ts` | Base64url helpers for cursor encoding/decoding.                                        |
| `type-utils.ts`        | General TypeScript helper types (`Awaitable`, `Constructor`, `Rec`).                   |

### 5.8 Testing (`/test`)

| File                   | Description                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `test/app.e2e-spec.ts` | Supertest-based E2E test hitting `GET /`.                                 |
| `test/jest-e2e.json`   | Jest configuration for the E2E suite.                                     |
| `package.json`         | Configures Jest for unit tests (`rootDir: src`) and exposes test scripts. |

## 6. Cross-cutting Behaviour

### 6.1 Bootstrapping Flow

1. `src/main.ts` creates the Nest application with buffered logs.
2. `ConfigPort` (provided by `EnvConfigAdapter`) supplies HTTP timeouts, body limits, and port.
3. Express middlewares apply JSON/urlencoded limits; CORS is enabled with permissive defaults.
4. URI versioning defaults to `v1`.
5. Once listening, the `nestjs-pino` logger emits a startup message with environment context.

### 6.2 Configuration Pipeline

- `.env*` files are loaded via `dotenv-flow` as soon as the config adapter is instantiated.
- `hydrate()` in `env-config.adapter.ts` maps raw environment variables into namespaced objects.
- Composite Zod schemas validate the shape; failures log sanitized error details and exit.
- `ConfigPort.get('namespace.key')` provides dot-path access for strongly typed lookups.
- `ConfigPort.isDevelopment()` toggles development-only logging transports.

### 6.3 Logging

- `nestjs-pino` is configured in `pino.module.ts` using `generatePinoOptions`.
- `genReqId` ensures every request carries a correlation ID (header + `req.id`).
- Sensitive headers (`Authorization`, cookies) are redacted before log emission.
- Daily file rotation is handled by `pino-roll` when `logging.toFile` is true.
- Pretty logging is enabled automatically in development environments.
- `LoggerPort` abstracts the logger, allowing application/domain code to depend on interfaces rather than concrete logging libraries.

### 6.4 HTTP Pipeline & Error Handling

1. Requests pass through `nestjs-pino` for tracing.
2. `ZodHttpInterceptor` validates request segments when a route uses `@UseZodHttp`.
3. Handlers may return plain values, `Result` objects, or pre-built envelopes.
4. `ResponseFormatterInterceptor` wraps responses in the standard envelope, merging metadata when handlers provide their own.
5. Exceptions bubble into `GlobalExceptionFilter`, which:
    - Preserves `HttpException` status codes and adapts bodies to the envelope shape.
    - Delegates to `ErrorPresenter` for domain/application errors.
    - Logs warnings/errors with optional sanitized stack traces.
6. `FallbackController` throws a typed `NotFoundError` for any route miss, guaranteeing consistent 404 payloads.

### 6.5 Validation

- Zod schemas enforce both configuration (startup) and request-time validation.
- `ZodValidationPipe` offers a portable alternative when decorators are not viable.
- Pagination schemas standardize offsets/cursors, including strict `orderBy` formats.

### 6.6 Result Handling & Pagination

- `Result` helpers (`src/shared/result.ts`) allow use cases to avoid throwing and still communicate success/failure clearly.
- `ResponseFormatterInterceptor` recognizes these `Result` objects, automatically turning them into success/error envelopes.
- Cursor helpers (`src/shared/pagination/cursor.ts`) encapsulate opaque tokens, ensuring consistent encoding across interfaces.

## 7. Configuration & Environment Variables

| Variable              | Default                                                             | Description                                                         |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `NODE_ENV`            | _(required)_ (`development` \| `test` \| `staging` \| `production`) | Drives environment-specific behaviour (`ConfigPort.isDevelopment`). |
| `LOG_LEVEL`           | `info`                                                              | Pino log level (`debug`, `info`, `warn`, `error`).                  |
| `SHOW_STACK_TRACES`   | `false`                                                             | Logs/returns stack traces when true.                                |
| `REQUEST_ID_HEADER`   | `x-request-id`                                                      | Header used for correlation IDs.                                    |
| `LOGGING_TO_FILE`     | `true`                                                              | Enables rolling file logging through `pino-roll`.                   |
| `LOGGING_DIR`         | `logs`                                                              | Target directory for log files.                                     |
| `LOGGING_FILE_NAME`   | `app.log`                                                           | Log file name (rolled daily).                                       |
| `LOGGING_FILES_LIMIT` | `14`                                                                | Retained rolled files (plus the current file).                      |
| `LOGGING_MAX_SIZE`    | `10M`                                                               | Max size per log file before rotation.                              |
| `PORT`                | `3000`                                                              | HTTP listen port.                                                   |
| `CORS_ORIGIN`         | _(unset)_                                                           | Comma-separated allowed origins (see note about schema mismatch).   |
| `SERVER_TIMEOUT`      | `120000`                                                            | HTTP server timeout (ms).                                           |
| `HEADERS_TIMEOUT`     | `121000`                                                            | Headers timeout (ms).                                               |
| `KEEP_ALIVE_TIMEOUT`  | `61000`                                                             | Keep-alive timeout (ms).                                            |
| `JSON_BODY_LIMIT`     | `1mb`                                                               | Express JSON body limit.                                            |
| `URL_ENCODED_LIMIT`   | `1mb`                                                               | Express urlencoded body limit.                                      |

`.env.example` documents the variables, and `.env.development` offers sample values for local use. Update the sample to keep schema expectations in sync (see Additional Notes).

## 8. Developer Workflow

### 8.1 Installation & Build

```bash
pnpm install
pnpm build       # produces dist/
```

### 8.2 Local Execution

```bash
pnpm start        # standard Nest start
pnpm start:dev    # watch mode with NODE_ENV=development
pnpm start:debug  # watch mode + Node inspector
pnpm start:prod   # runs dist/main.js (build first)
pnpm start:repl   # launches Nest REPL (src/repl.ts)
```

### 8.3 Quality Gates

```bash
pnpm lint           # ESLint over src/apps/libs/test
pnpm lint:fix       # ESLint with --fix
pnpm format         # Prettier write over src/** and test/**
pnpm format:check   # Prettier check mode
pnpm test           # Jest unit tests
pnpm test:watch     # Jest watch mode
pnpm test:cov       # Coverage report
pnpm test:e2e       # E2E suite (test/jest-e2e.json)
```

## 9. Extensibility Guidelines

1. **Model the domain** — create entities/value objects/errors under `src/domain`.
2. **Define ports & use cases** — add interfaces and use-case orchestrators under `src/application`, returning `Result` objects where appropriate.
3. **Expose via interface** — build controllers in `src/interface/http`, attach validation with `@UseZodHttp`, and rely on interceptors for envelopes.
4. **Implement adapters** — satisfy ports inside `src/infrastructure` and register them with `ProviderFactory`.
5. **Test** — write unit tests for domain/application logic and add E2E coverage under `test/` for new HTTP endpoints.

## 10. Additional Notes & Observations

- `docs/diagrams.drawio` can store architecture diagrams referenced in onboarding material.
- Logs default to the `logs/` directory; ensure deployment environments grant write permissions or toggle `LOGGING_TO_FILE`.
