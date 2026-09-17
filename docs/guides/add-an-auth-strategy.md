# Add an authentication strategy

How authentication works here, how to add a second way of authenticating (API key, JWKS, mutual TLS header, anything), and how to choose where it applies: globally, per controller or per route.

Terms: [Glossary](../glossary.md). The HTTP layer in general: [HTTP interface](../architecture/http-interface.md).

## How it works today

| Piece                                       | Where                                                                       | Does                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `JwtStrategy`                               | `src/infrastructure/auth/strategies/jwt.strategy.ts`                        | verifies the token (cookie first, then `Authorization: Bearer`) and returns the payload |
| `AuthModule`                                | `src/infrastructure/auth/auth.module.ts`                                    | registers the strategies with Passport                                                  |
| `JwtGuard`                                  | `src/interface/http/guards/jwt.guard.ts`                                    | runs the strategy per request, unless the route is `@Public()`                          |
| `@Public()`                                 | `src/interface/http/decorators/public.decorator.ts`                         | opens one handler or a whole controller                                                 |
| `@Roles()` + `RolesGuard`                   | `src/interface/http/decorators/roles.decorator.ts`, `guards/roles.guard.ts` | requires a role from the token; global, so it cannot be forgotten                       |
| `@CurrentUser()` / `getAuthenticatedUser()` | `src/interface/http/decorators`, `src/interface/http/guards`                | read the authenticated user in a controller or a guard                                  |
| `Request.user`                              | `src/infrastructure/auth/types/express.d.ts`                                | types what a strategy puts on the request                                               |

**Authentication is global**: `JwtGuard` is registered as an `APP_GUARD` in `src/interface/interface.module.ts`, so a new route is protected the moment it exists. Routes open up by saying so; they don't opt in. Forgetting a decorator gives you a 401, not an open endpoint.

This service only **verifies** tokens; it never issues them.

## Choosing where a strategy applies

### Globally (the default)

```ts
// src/interface/interface.module.ts
providers: [
    ProviderFactory.class(APP_GUARD, ThrottlerGuard),
    ProviderFactory.class(APP_GUARD, CsrfGuard),
    ProviderFactory.class(APP_GUARD, JwtGuard),
    ProviderFactory.class(APP_GUARD, RolesGuard),
],
```

Guards run in registration order, so throttling and CSRF are checked before the token.

### Opening a route

```ts
import { Public } from '@interface/http/decorators';

@Public() // whole controller
@Controller('status')
export class StatusController {
    @Get()
    read() {
        return { status: 'ok' };
    }
}

@Controller('tickets')
export class TicketsController {
    @Public() // this handler only; the rest of the controller stays protected
    @Get('public-summary')
    summary() {
        return this.getSummary.execute();
    }

    @Get() // says nothing → protected
    list() {
        return this.listTickets.execute();
    }
}
```

Already public in the template: `HealthController` (monitors poll it), `FallbackController` (unknown paths answer 404 instead of 401) and the root `AppController`.

**Keep the list of `@Public()` routes short and reviewed.** It is the whole attack surface that needs no token.

### Per controller instead of globally

If a project wants authentication opt-in — for example a service that is mostly public with a few protected admin routes — remove the global registration and apply the guard by hand:

```ts
// src/interface/interface.module.ts: drop this line
ProviderFactory.class(APP_GUARD, JwtGuard),
```

```ts
import { JwtGuard } from '@interface/http/guards';

@UseGuards(JwtGuard)
@Controller('admin')
export class AdminController {}
```

`JwtGuard` works in both modes, and `@Public()` keeps working (it simply has nothing to open). What you lose is the safety net: a controller without the decorator is then reachable without a token, and nothing fails. If you go this way, add a test that walks the registered routes and asserts each one either carries the guard or is deliberately listed as public — otherwise the first forgotten decorator is a silent hole.

### A different strategy on some routes

```ts
@UseGuards(ApiKeyGuard) // replaces the global guard for this controller
@Controller('webhooks')
export class WebhookController {}
```

A route-level guard does not remove the global one: both run. When a route must use **only** the second strategy, mark it `@Public()` (switching the global guard off for it) and apply its own guard:

```ts
@Public()
@UseGuards(ApiKeyGuard)
@Controller('webhooks')
export class WebhookController {}
```

### Accepting either of two strategies

Passport can try several strategies and take the first that succeeds:

```ts
// src/interface/http/guards/api-or-jwt.guard.ts
@Injectable()
export class ApiOrJwtGuard extends AuthGuard(['jwt', 'api-key']) {}
```

Use it as the global guard (with the same `@Public()` check as `JwtGuard`) when both ways are valid everywhere, or per controller when only some routes accept a key.

## Add a strategy

Example: an API key for machine callers, alongside the existing JWT.

### 1. Configuration

Secrets and their sources go through the config pipeline ([Add a config variable](add-config-variable.md)); never read `process.env` in a strategy.

```ts
// src/infrastructure/config/schemas/api-key.schema.ts
import { z } from 'zod';

export const apiKeySchema = z.object({
    enabled: z.boolean().default(false),
    header: z.string().min(1).default('x-api-key'),
    keys: z.array(z.string().min(24)).default([]),
});

export type ApiKeyConfig = z.infer<typeof apiKeySchema>;
```

Hydrate it in `load-config.ts` with `envBool`/`envList`, add the variables to `.env.example` and to [Configuration](../architecture/configuration.md).

### 2. The strategy (infrastructure)

```ts
// src/infrastructure/auth/strategies/api-key.strategy.ts
import { ConfigPortToken, type ConfigPort } from '@application/ports';
import type { JWTPayload } from '@domain/auth';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { HeaderAPIKeyStrategy } from 'passport-headerapikey';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(HeaderAPIKeyStrategy, 'api-key') {
    private readonly keys: ReadonlySet<string>;

    constructor(@Inject(ConfigPortToken) config: ConfigPort) {
        super({ header: config.get('apiKey.header'), prefix: '' }, false);
        this.keys = new Set(config.get('apiKey.keys'));
    }

    validate(key: string): JWTPayload {
        if (!this.keys.has(key)) throw new UnauthorizedException();

        // what lands on `req.user`: the same shape the rest of the code expects
        return { username: 'service-account', sub: 'service-account' } as JWTPayload;
    }
}
```

Rules for a strategy:

- **Never log the credential**, not even truncated, and don't put it in an error `details`.
- **Compare secrets in constant time** when you compare them yourself (`crypto.timingSafeEqual`); a `Set` lookup as above is fine because it doesn't leak position.
- **Return the same user shape** every strategy returns, so controllers and the Oracle context user work regardless of how the caller authenticated. If the shapes genuinely differ, widen `JWTPayload`/`Request.user` in `src/infrastructure/auth/types/express.d.ts` and handle both.

Register it in `AuthModule`:

```ts
@Module({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    providers: [JwtStrategy, ApiKeyStrategy],
    exports: [JwtStrategy, ApiKeyStrategy],
})
export class AuthModule {}
```

### 3. The guard (interface)

One file per guard, named after it ([decision 0008](../decisions/0008-one-thing-per-file.md)):

```ts
// src/interface/http/guards/api-key.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class ApiKeyGuard extends AuthGuard('api-key') {}
```

Export it from `src/interface/http/guards/index.ts` (named exports only, [decision 0007](../decisions/0007-named-barrel-exports.md)).

### 4. Swagger

Add the scheme once in `swagger.config.ts` and a constant in `swagger.constants.ts`:

```ts
.addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, API_KEY_SECURITY)
```

Then mark the routes that accept it with `@ApiSecurity(API_KEY_SECURITY)`.

### 5. Tests

Both halves, or the strategy is untested behaviour on your front door ([Write tests](write-tests.md)):

- **Unit**: the guard lets a `@Public()` route through, and runs verification when nothing marks the route public (`test/unit/interface/http/guards/jwt.guard.spec.ts` is the pattern).
- **E2E**: a controller that declares nothing returns 401, a `@Public()` one returns 200, a handler-level `@Public()` doesn't open its neighbours, and a malformed credential is rejected (`test/e2e/auth.e2e-spec.ts`).

Prove the tests bite: remove the global guard registration and the "declares nothing" test must fail.

## Not a Passport strategy?

For authentication that isn't a credential check per request — a signed webhook body, mutual TLS terminated by the load balancer, an internal network header — write a plain guard instead:

```ts
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
    constructor(@Inject(ConfigPortToken) private readonly config: ConfigPort) {}

    canActivate(context: ExecutionContext): boolean {
        const { headers, body } = readGuardInput(context, 'headers', signatureHeaderSchema);
        if (!isValidSignature(body, headers, this.config.get('webhooks.secret'))) {
            throw new UnauthorizedError('Invalid signature');
        }
        return true;
    }
}
```

Guards **throw** `UnauthorizedError`/`ForbiddenError` rather than returning `false`, so the client gets the envelope with the right status instead of Nest's bare 403. Validate anything you read from the request with `readGuardInput` — guards run before validation.

## Authorization comes after

A strategy answers _who is calling_. _What they may do_ is a separate check, and where it belongs depends on what it needs to know:

| The check                                                       | Where it belongs                             | Needs the database?          |
| --------------------------------------------------------------- | -------------------------------------------- | ---------------------------- |
| "the token says `admin` / `role=…`"                             | guard, reading `req.user`                    | no                           |
| "this user's roles/regions are stored in a table"               | guard **through a query port** (see below)   | yes, one cached lookup       |
| "this user owns this ticket" / "this ticket is in their region" | use case, where the aggregate is loaded      | yes, as part of the work     |
| "only rows of this user's tenant are visible"                   | the query itself (a bound `WHERE` predicate) | yes, and never as a 403 gate |

Roles carried by the token are built in. `JWTPayload.roles` (`src/domain/auth/jwt-payload.interface.ts`) holds what the issuer put there, `@Roles()` names what a route needs, and the global `RolesGuard` checks it — no database, no `@UseGuards` to forget:

```ts
import { Roles } from '@interface/http/decorators';

@Controller('reports')
export class ReportsController {
    @Roles('admin', 'auditor') // holding either one is enough
    @Get('financial')
    financial() {
        return this.getFinancialReport.execute();
    }

    @Get() // names no role: any authenticated caller
    list() {
        return this.listReports.execute();
    }
}
```

- A route with no `@Roles()` is unaffected: authentication still applies, the role check doesn't.
- A caller whose token carries none of the named roles gets **403**; no token at all is still **401**, from `JwtGuard`.
- `@Roles()` on the controller applies to every handler; on a handler it overrides the controller.
- If your tokens name roles differently (`groups`, `scope`, a nested claim), map them to `roles` in `JwtStrategy.validate()` rather than teaching the guard about every issuer's shape.
- The template's `JWTPayload` also has `admin: boolean`; treat it as legacy — prefer roles, and if you keep it, check it in the same guard rather than inventing a second one.

## Authorization that needs the database

Valid, and common: the token proves identity, but who may do what lives in a table another team maintains. Do it through a **query port**, not with SQL in the guard.

### 1. Port and DAO

```ts
// src/application/ports/queries/user-permissions.query.port.ts
import { createToken } from '@shared';
import type { QueryOptions } from './query-options';

export type UserPermissions = {
    roles: readonly string[];
    regions: readonly string[];
};

export interface UserPermissionsQueryPort {
    findByUsername(username: string, options?: QueryOptions): Promise<UserPermissions>;
}

export const UserPermissionsQueryPortToken = createToken<UserPermissionsQueryPort>(
    'UserPermissionsQueryPort',
);
```

The DAO goes in `infrastructure/database/queries` and is wired in `database.module.ts` like any other ([Add a query port and DAO](add-query-port-and-dao.md)):

```ts
ProviderFactory.factory(
    UserPermissionsQueryPortToken,
    (db: ConnectionProvider) => new UserPermissionsQueryDao(db),
    [ConnectionProviderToken],
),
```

### 2. The guard

```ts
// src/interface/http/guards/region.guard.ts
@Injectable()
export class RegionGuard implements CanActivate {
    constructor(
        @Inject(UserPermissionsQueryPortToken)
        private readonly permissions: UserPermissionsQueryPort,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        // guards run before validation: never pass a raw param to the database
        const { region } = readGuardInput(context, 'params', z.object({ region: regionSchema }));
        const user = getAuthenticatedUser(context);

        const { regions } = await this.permissions.findByUsername(user.username, {
            actor: user.username,
        });

        if (!regions.includes(region)) {
            throw new ForbiddenError(`No access to region ${region}`);
        }
        return true;
    }
}
```

### Rules for a guard that queries

- **Through a port, always.** The interface layer may not reach into `ConnectionProvider`, a DAO or `oracledb`; it depends on the token. That is what keeps the guard testable with a fake instead of a database.
- **One lookup per request, not one per check.** Two guards each fetching the same user's permissions doubles the round trips. Fetch roles and regions in one query, and if several guards need it, stash the result on the request (`req.permissions`) so the second guard reuses it.
- **Cache, and know what the TTL costs you.** A 30–60 second cache turns per-request latency into one query per user per minute; it also means a revoked permission keeps working for that long. Pick the TTL with whoever owns the access rules, and write it down.
- **Pass `actor`** so the database sees who acted (`CLIENT_IDENTIFIER`) and the lookup appears in the audit trail like any other call.
- **Never turn an outage into a 403.** If the lookup throws `DatabaseConnectionError`, let it surface — the filter maps it to **503**. Catching it and returning `false`/`ForbiddenError` tells the caller they lack permission when the truth is the database is down, and it hides an incident behind a permission error. Failing closed is right; lying about why is not.
- **Keep it read-only.** No writes, no transactions, no unit of work in a guard. A guard has no commit boundary, and a request rejected later still leaves whatever it wrote behind.
- **Log the refusal once**, with the username and what was refused — never the token, the cookie or the SQL.
- **Watch the pool.** Guards run on every request that reaches the route, including ones that fail validation a moment later; `poolMax` is shared with the real work. If a guard's query is slow, every endpoint behind it is slow.

### When it is the wrong place

| Case                                                                 | Why not a guard                                                                                                            | Do instead                                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| "does this user own ticket 42?"                                      | the guard loads the ticket, the use case loads it again: two queries and two sources of truth that drift                   | check it in the use case, after the repository returns the aggregate    |
| "only show rows of this user's tenant/region"                        | a gate can't filter a list; it either passes the whole request or refuses it                                               | a bound predicate in the DAO query, from the authenticated user         |
| "hide that the resource exists from callers who may not see it"      | the guard doesn't know whether it exists without loading it                                                                | use case: 404 for both "missing" and "not yours", deliberately          |
| anything that writes (audit row, "last seen", consuming a quota)     | guards have no transaction and run on requests that later fail validation                                                  | a use case, or an interceptor after a successful response               |
| a chain of guards each hitting the database                          | round trips multiply per request and per endpoint                                                                          | one permissions lookup, cached, shared through the request              |
| business rules dressed as authorization ("only during office hours") | it isn't authentication or authorization; hiding it in a guard puts a rule outside the domain, untested and undiscoverable | domain/use case, returning a domain error that maps to the right status |

Rule of thumb: a guard answers **"may this caller reach this endpoint at all?"** with data about the _caller_. Anything that needs the _resource_ belongs to the use case.

### Testing it

- **Unit**: the guard with a fake port — allowed, refused (`ForbiddenError`), missing user (`UnauthorizedError`), invalid param (400), and the port throwing `DatabaseConnectionError` (it must propagate, not become a 403).
- **E2E**: one allowed and one refused request, with the port overridden (`.overrideProvider(UserPermissionsQueryPortToken).useValue(fake)`).

## Checklist

- [ ] Strategy in `src/infrastructure/auth/strategies`, registered in `AuthModule`
- [ ] Secrets through the config schema, in `.env.example` and documented; nothing read from `process.env`
- [ ] Guard in `src/interface/http/guards`, exported from the barrel
- [ ] Decided where it applies: global, per controller, or `@Public()` + its own guard
- [ ] `@Public()` list reviewed — that is the surface reachable without credentials
- [ ] Credential never logged; user shape matches what controllers and the context user expect
- [ ] Swagger security scheme added and applied to the routes that accept it
- [ ] Roles that come from the token declared with `@Roles()`, not re-implemented in a controller
- [ ] Authorization placed by what it needs: caller data → guard, resource data → use case, row filtering → the query
- [ ] A guard that queries goes through a port, caches, passes `actor`, and lets a database outage surface as 503
- [ ] Unit test for the guard, e2e for protected and open routes, mutation-checked
