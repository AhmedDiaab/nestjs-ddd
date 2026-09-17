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
- Shared schemas: `schemas/pagination.schema.ts` (`OffsetQuerySchema`, `CursorQuerySchema`, `parseOrderBy`).

Keep HTTP schemas structural (types, formats, enums, ranges). Business rules (trim, max length meaning, state rules) belong to domain value objects, which return 422.

## Authentication

- `JwtStrategy` (`src/infrastructure/auth/strategies/jwt.strategy.ts`) reads the token from the cookie named by `JWT_COOKIE_NAME` (default `jwt`), falling back to `Authorization: Bearer`. It verifies the secret, `JWT_ALGORITHMS`, `JWT_ISSUER` and `JWT_AUDIENCE`.
- `@UseGuards(JwtGuard)` on a controller or route returns 401 without a valid token.
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

## Swagger

- Served at `/docs` when `SWAGGER_ENABLED=true`; defaults to on outside production and off in production.
- Security schemes: `cookie-auth` and `bearer-auth` (`swagger/swagger.constants.ts`); mark routes with `@ApiBearerAuth(BEARER_SECURITY)` / `@ApiCookieAuth(COOKIE_SECURITY)`.
- Group endpoints with `@ApiTags`; hide internal controllers with `@ApiExcludeController()`.

## Versioning

URI versioning with default `1`: routes are `/v1/...`. Health routes are `VERSION_NEUTRAL` (`/health`). For a v2 route: `@Controller({ path: 'tickets', version: '2' })`.

## Security defaults

| Concern    | Default                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headers    | `helmet()`                                                                                                                                                                                                                                                                                                                                                                                                              |
| CORS       | disabled unless `CORS_ORIGINS` lists origins; `credentials: true`                                                                                                                                                                                                                                                                                                                                                       |
| Rate limit | global `ThrottlerGuard`, `THROTTLE_LIMIT` per `THROTTLE_TTL_MS` per client IP (`TRUST_PROXY=true` behind a load balancer); `/health` skipped via `@SkipThrottle()`. Counters are per instance unless `THROTTLE_STORAGE=redis` (storage built in `infrastructure/throttling`)                                                                                                                                            |
| Body size  | `JSON_BODY_LIMIT`, `URLENCODED_BODY_LIMIT` (413 when exceeded)                                                                                                                                                                                                                                                                                                                                                          |
| Logs       | `Authorization`, `Cookie`, `Set-Cookie` removed                                                                                                                                                                                                                                                                                                                                                                         |
| CSRF       | global `CsrfGuard` (`CSRF_ENABLED`, default on): a POST/PUT/PATCH/DELETE carrying the JWT cookie must come from the API's own origin or `CSRF_TRUSTED_ORIGINS` (default `CORS_ORIGINS`), checked via `Sec-Fetch-Site`, `Origin`, then `Referer`; otherwise **403 `CSRF_REJECTED`**. Requests without the cookie or with an `Authorization` header are unaffected. Also issue the cookie with `SameSite=Lax` or `Strict` |

## Controllers

| Controller               | Routes                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `AppController`          | `GET /v1`: hello (sample)                                                                                   |
| `HealthController`       | `GET /health`, `GET /health/ready` (see [Operations](operations.md#health-endpoints))                       |
| `DatabaseInfoController` | `GET /v1/database-info` (JWT): shows the DB name, session user and the `CLIENT_IDENTIFIER` the database saw |
| `FallbackController`     | any unmatched route → 404                                                                                   |

## Related

- [Add a controller](../guides/add-controller.md)
- [Add an error](../guides/add-error.md)
