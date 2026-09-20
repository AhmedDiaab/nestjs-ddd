# HTTP interface

`src/interface/http`: translates HTTP to use-case calls and results back to HTTP.

## Response envelope

Every JSON response has one shape (`src/shared/response-envelope.ts`):

```jsonc
// success
{ "success": true,  "data": { ... }, "meta": { "timestamp": "...", "path": "/v1/tickets", "requestId": "..." } }
// error
{ "success": false, "error": { "message": "...", "code": "...", "details": ..., "type": "urn:nestjs-ddd:problem:not-found" }, "meta": { ... } }
```

`type` is a stable URN built from `APP_NAME` (`src/shared/app.constants.ts`), which must equal the `package.json` name (a unit test checks this). Set both for a new project with `pnpm rename-project <kebab-name>`; don't change it after clients depend on the URNs.

`ResponseFormatterInterceptor`:

| Handler returns                                | Response                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| plain value                                    | `{ success: true, data: value, meta }`                               |
| `Result.ok(value)`                             | `{ success: true, data: value, meta }`                               |
| `Result.err(AppError/DomainError)`             | rethrown, handled by the exception filter (status from problem kind) |
| `Result.err('code')` / other                   | 422 with `error.code`                                                |
| object already shaped `{ success, meta, ... }` | meta merged, passed through                                          |
| `Buffer`, `StreamableFile`, `Readable`         | untouched                                                            |
| request header `x-skip-format` set             | untouched                                                            |

A paginated result (`PageEnvelope`) is nested: `data.data` holds the items, `data.meta` holds `hasNext`/`hasPrev`.

## Errors → status

`GlobalExceptionFilter` + `ErrorPresenter`:

| Source                                      | Status                                                                                                                                                                     | Body                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `HttpException` (Nest, throttler, JwtGuard) | its status                                                                                                                                                                 | `message`, `code`, `details` from the exception     |
| body-parser errors (`expose: true`)         | 413 too large, 400 malformed JSON                                                                                                                                          | parser message, `code` = parser type                |
| `AppError` / `DomainError`                  | by problem kind: validation 422, not_found 404, conflict 409, unauthorized 401, forbidden 403, bad_request 400, service_unavailable 503, not_implemented 501, internal 500 | `detail` as `message`, domain `errors` as `details` |
| anything else                               | 500                                                                                                                                                                        | `"Unexpected error"`                                |

- 4xx are logged as `warn` and 5xx as `error`, always; stacks only when `SHOW_STACK_TRACES=true`.
- Internal `details` and ORA codes are never sent to clients.
- Unknown routes hit `FallbackController`, which returns a 404 envelope.

## Validation

`@UseZodHttp` + `ZodHttpInterceptor`:

```ts
@Get()
@UseZodHttp({ query: listTicketsQuerySchema })
list(@Validated('query') query: ListTicketsQuery) { ... }
```

- Validates `body`, `query`, `params`, `headers`; on failure returns **400** with `details: ["query.size: Too big: expected number to be <=100"]`.
- Parsed values (with Zod defaults and coercion) are stored on `req.validated[part]`; read them with `@Validated('part')`.
- `body` and `params` are also replaced in place; **`req.query` is never assigned** (read-only in Express 5).
- Set `async: true` in the schema options when refinements are async.
- Alternative for single parameters: `@Body(new ZodValidationPipe(schema))`.
- Shared schemas: `schemas/pagination.schema.ts` (`OffsetQuerySchema`, `CursorQuerySchema`); `schemas/order-by.util.ts` (`parseOrderBy`).

Keep HTTP schemas structural (types, formats, enums, ranges). Business rules (trim, max length meaning, state rules) belong to domain value objects, which return 422.

## Idempotency

`@Idempotent()` (`interface/http/decorators/idempotent.decorator.ts`) + `IdempotencyInterceptor` let a handler declare that a request carrying a known `Idempotency-Key` header runs at most once: a retry with the same key and body gets the first response back instead of running the handler again. Opt-in, like `@Public()` and `@Roles()` — nothing runs unless the handler is decorated.

`IdempotencyInterceptor` is registered **after** `ResponseFormatterInterceptor`, making it the **innermost** interceptor in the chain (`interface.module.ts`). That ordering is deliberate: it stores and replays the handler's own raw payload, not the `{ success, data, meta }` envelope, so a replay is re-wrapped with the _replaying_ request's own `requestId`/`timestamp` rather than resurrecting the original's stale ones. Registering it before `ResponseFormatterInterceptor` instead would store the envelope itself, and a replay would carry a dead request id.

The key is fingerprinted against the exact request bytes (SHA-256 of method + path + the raw body), backed by `IdempotencyStorePort` (an in-memory adapter for a single instance, an Oracle adapter for a shared/durable store). Full behaviour table, configuration and the effect-atomicity limitation: [Make an endpoint idempotent](../guides/make-an-endpoint-idempotent.md).

## Deprecation

`@Deprecated({ since, sunset, successor?, link?, note? })` (`interface/http/decorators/deprecated.decorator.ts`) + `DeprecationInterceptor` mark a route as going away: every response carries `Deprecation` (RFC 9745, a Structured Fields Date `@<unix-seconds>`, no boolean form), `Sunset` (RFC 8594, an IMF-fixdate) and, when `successor`/`link` are given, a joined `Link` header (`rel="successor-version"` per RFC 5829, `rel="deprecation"` per RFC 9745). Swagger shows the operation as `deprecated: true`. Opt-in, like `@Public()`/`@Idempotent()` — nothing changes until the route carries the decorator.

`since`/`sunset` are both required (the header has no valueless form, and a deprecation with no retirement date isn't a policy) and validated with Zod **inside the decorator factory**, so a bad date throws at module load — effectively at boot — rather than on the route's first request. `DeprecationInterceptor` is registered **between `MetricsInterceptor` and `ZodHttpInterceptor`**, as early as possible: it only sets headers before `next.handle()` and never touches the return value, so the headers survive a later rejection (a 400 from Zod, a 500 from the handler) instead of being skipped because something downstream failed first. The headers are advisory — a route past its `sunset` date still answers normally; nothing here enforces a cutoff. Full options, the client-visible header block and the retirement policy: [Make an endpoint deprecated](../guides/make-an-endpoint-deprecated.md); rationale: [decision 0009](../decisions/0009-deprecation-dates-live-on-the-route-not-config.md).

## Authentication

- `JwtStrategy` (`src/infrastructure/auth/strategies/jwt.strategy.ts`) reads the token from the cookie named by `JWT_COOKIE_NAME` (default `jwt`), falling back to `Authorization: Bearer`. It verifies the secret, `JWT_ALGORITHMS`, `JWT_ISSUER` and `JWT_AUDIENCE`.
- `JwtGuard` is registered **globally** (`APP_GUARD` in `interface.module.ts`): every route needs a valid token unless it is marked `@Public()`. A new route is protected by default; forgetting a decorator gives a 401, not an open endpoint.
- `@Public()` (`decorators/public.decorator.ts`) opens one handler or a whole controller. Public in the template: `HealthController`, `MetricsController` and `FallbackController` (unknown paths stay 404).
- `@Roles('admin', 'auditor')` requires one of those roles from `JWTPayload.roles`; the global `RolesGuard` answers **403** when none match. Routes without `@Roles()` are unaffected. `HealthSourcesController` is the template's example: no `@Public()`, so the global `JwtGuard` applies, plus `@Roles('admin')`. Roles that live in a table instead of the token go through a query port ([guide](../guides/add-an-auth-strategy.md#authorization-that-needs-the-database)).
- `@UseGuards(JwtGuard)` still works for a per-controller setup; adding another strategy or making authentication opt-in: [Add an authentication strategy](../guides/add-an-auth-strategy.md).
- `@CurrentUser()` injects `req.user` (`JWTPayload`); `@CurrentUser('username')` injects one field.
- This service only **verifies** tokens; issuing them is another service's job.

## Guards

Guards run **before** interceptors and pipes, so anything a guard reads from the request is unvalidated. Two rules:

```ts
const { name } = readGuardInput(context, 'params', z.object({ name: siteNameSchema })); // 400 if invalid
const user = getAuthenticatedUser(context); // 401 if missing
if (!allowed) throw new ForbiddenError('Insufficient region privileges'); // 403
```

- Throw an `AppError`; don't `return false`, which gives a generic 403 without details.
- Each guard that calls a use case adds database round trips. Combine checks (one query) or cache them when latency matters.
- Authorization that needs the database goes through a query port, never SQL in the guard; checks about the **resource** (ownership, row filtering) belong to the use case instead: [Add an authentication strategy → Authorization that needs the database](../guides/add-an-auth-strategy.md#authorization-that-needs-the-database).

## Swagger

- Served at `/docs` when `SWAGGER_ENABLED=true`; defaults to on outside production and off in production.
- Security schemes: `cookie-auth` and `bearer-auth` (`swagger/swagger.constants.ts`); mark routes with `@ApiBearerAuth(BEARER_SECURITY)` / `@ApiCookieAuth(COOKIE_SECURITY)`.
- Group endpoints with `@ApiTags`; hide internal controllers with `@ApiExcludeController()`.
- **Inputs come from the Zod schemas.** `@UseZodHttp({ body, query, params, headers })` on a method also adds the Swagger request body, one query/path parameter or header per schema property (type, constraints, defaults, enums, `.describe()` text, required flags). There are no DTO classes to keep in sync. Generation uses Zod's `z.toJSONSchema` with the OpenAPI 3.0 target (`swagger/zod-openapi.ts`).
- **Responses:** add `@ZodResponse(status, schema)` (`swagger/zod-response.decorator.ts`) to document `data` inside the `{ success: true, data, meta }` envelope. Errors use the envelope in [Response envelope](#response-envelope).

## Versioning

URI versioning with default `1`: routes are `/v1/...`. Health routes are `VERSION_NEUTRAL` (`/health`). For a v2 route: `@Controller({ path: 'tickets', version: '2' })`.

## Security defaults

| Concern    | Default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headers    | `helmet()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| CORS       | disabled unless `CORS_ORIGINS` lists origins; `credentials: true`                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Rate limit | global `ThrottlerGuard`, `THROTTLE_LIMIT` per `THROTTLE_TTL_MS` per client IP (`TRUST_PROXY=true` behind a load balancer); `/health` skipped via `@SkipThrottle()`. Counters are per instance unless `THROTTLE_STORAGE=redis` (storage built in `infrastructure/throttling`)                                                                                                                                                                                                              |
| Body size  | `JSON_BODY_LIMIT`, `URLENCODED_BODY_LIMIT` (413 when exceeded)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Logs       | `Authorization`, `Cookie`, `Set-Cookie` removed                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CSRF       | global `CsrfGuard` (`guards/csrf.guard.ts`, error in `errors/csrf-rejected.error.ts`; `CSRF_ENABLED`, default on): a POST/PUT/PATCH/DELETE carrying the JWT cookie must come from the API's own origin or `CSRF_TRUSTED_ORIGINS` (default `CORS_ORIGINS`), checked via `Sec-Fetch-Site`, `Origin`, then `Referer`; otherwise **403 `CSRF_REJECTED`**. Requests without the cookie or with an `Authorization` header are unaffected. Also issue the cookie with `SameSite=Lax` or `Strict` |

## Controllers

| Controller                | Routes                                                                                                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HealthController`        | `GET /health` (liveness), `GET /health/ready` (readiness, body is `{status}` only) — `@Public()`, `@SkipThrottle()` (see [Operations](operations.md#health-endpoints)) |
| `HealthSourcesController` | `GET /v1/health/sources` (JWT + `@Roles('admin')`): the per-source detail (dialect, latency, `error`) that `/health/ready` used to publish to anyone                   |
| `MetricsController`       | `GET /metrics` when `METRICS_ENABLED` (see [Observability](observability.md))                                                                                          |
| `DatabaseInfoController`  | `GET /v1/database-info` (JWT): shows the DB name, session user and the `CLIENT_IDENTIFIER` the database saw                                                            |
| `FallbackController`      | any unmatched route → 404                                                                                                                                              |

## Related

- [Add a controller](../guides/add-controller.md)
- [Add an error](../guides/add-error.md)
- [Make an endpoint idempotent](../guides/make-an-endpoint-idempotent.md)
- [Make an endpoint deprecated](../guides/make-an-endpoint-deprecated.md)
