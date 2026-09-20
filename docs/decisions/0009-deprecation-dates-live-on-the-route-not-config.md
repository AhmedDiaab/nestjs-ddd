# 0009. Deprecation dates live on the route, not config

- Status: Accepted
- Date: 2026-09-20

## Context

URI versioning (`app.enableVersioning`, default `1`) lets a new version of a route exist
alongside an old one, but nothing told a client that the old one is going away, and there was no
written retirement policy — when a deprecation announcement has to happen relative to a release,
how long a sunset route must keep serving, what a client can rely on. Two IETF RFCs cover exactly
this: RFC 9745 defines the `Deprecation` response header, RFC 8594 defines `Sunset`, and RFC 5829
registers `rel="successor-version"` for the `Link` header (RFC 9745 itself only documents
`rel="deprecation"`, a documentation link — conflating the two would misattribute a relation this
RFC doesn't define).

## Decision

- **`since` and `sunset` are both required inputs to `@Deprecated(...)`, with no boolean
  shorthand.** RFC 9745 §3.3.7 requires `Deprecation`'s value to be a Structured Fields Item whose
  value is a Date (RFC 9651 §3.3.7) — serialized `@<unix-seconds>`, e.g. `Deprecation:
@1688169599`. There is no valueless/boolean form for this field, so a decorator that accepted
  `@Deprecated()` with no date would have nothing correct to put in the header. `sunset` is
  required for a different reason: a deprecation notice with no retirement date is a shrug, not a
  policy, and this template's guides consistently ask for a stated date over an open-ended
  "eventually" (see the idempotency guide's TTL discussion for the same instinct applied
  elsewhere). RFC 9745 also requires `Sunset` not be earlier than `Deprecation`; the decorator
  enforces that as a Zod refinement naming both dates, rather than leaving it to be discovered in
  production.
- **The dates live on the route (`@Deprecated({ since, sunset, ... })`), not in
  `load-config.ts`/env.** A route's deprecation timeline is a fact about that route's code, decided
  at the same time and by the same person who deprecates it — it belongs in source control, next
  to the handler, with the same review and diff visibility as the rest of the change. Env config
  in this template is for things that vary **by deployment** (a pool size, a feature flag, a
  timeout) without a code change; a deprecation date is the opposite — it should NOT be possible to
  change by editing `.env.production` without a code review, and every environment must present
  the same deprecation timeline to every client. There is also no natural key: config is
  effectively a flat namespace, so N deprecated routes would need N parallel env vars
  (`TICKETS_V1_DEPRECATION_SINCE`, `TICKETS_V1_DEPRECATION_SUNSET`, …) invented and wired by hand
  for every route, whereas the decorator scales to any number of routes with zero config surface.
- **Validation happens inside the decorator factory, with Zod, and throws a plain `Error`.** The
  factory runs once, when the module defining the controller is loaded — before Nest finishes
  bootstrapping, i.e. effectively at boot, the same moment `InvalidConfigError` would surface a bad
  environment variable. A malformed `since`/`sunset`, a `sunset` before `since`, or a relative
  `successor`/`link` URL is a programmer mistake made while writing the decorator call, not a
  runtime condition a client triggered — so it is a plain `Error` (matching `InvalidConfigError`'s
  own choice not to be an `AppError`), not a `Result` failure or a domain error with an HTTP
  status. Validation (`parseDeprecatedOptions`) and formatting (`formatDeprecationHeaders`) are two
  functions in `deprecation-headers.util.ts`, not one, specifically so each can be tested without
  faking the other's input.
- **The decorator stores the _formatted_ headers in metadata, not the raw `since`/`sunset`
  strings.** `DeprecationInterceptor` reads `Reflector.getAllAndOverride(...)` on every matching
  request; if it stored the raw options it would recompute the Unix timestamp and re-format the
  `Sunset` date on every request to every deprecated route. Formatting once, at decoration time,
  makes the interceptor itself a handful of lines: read metadata, set headers if present, pass the
  value through.
- **`DeprecationInterceptor` is registered between `MetricsInterceptor` and `ZodHttpInterceptor`,
  i.e. as early as possible.** It only calls `res.setHeader(...)` before `next.handle()` runs, and
  never reads or transforms the handler's return value — so unlike `IdempotencyInterceptor` (which
  has to be the _innermost_ interceptor because it stores/replays the raw payload before the
  response envelope wraps it, see [Make an endpoint
  idempotent](../guides/make-an-endpoint-idempotent.md)), there is no ordering requirement pulling
  `DeprecationInterceptor` inward. Running it early instead means the headers are already on the
  response by the time a later interceptor, `ZodHttpInterceptor`'s validation, or the handler
  itself fails — a 400 from a bad query param or a 500 from the handler still carries the
  deprecation notice, which is the more useful behaviour for a client deciding whether to keep
  calling a route at all.

## Consequences

- Adding or removing a deprecation is a one-line decorator change on the route, reviewed and
  diffed like any other code change; there is nothing to configure per environment and nothing in
  `.env.example`.
- A malformed `@Deprecated(...)` call fails the whole application at boot (module load throws),
  the same blast radius as a bad `InvalidConfigError` — caught in CI/local dev, never reaching a
  running deployment.
- A request a guard rejects (401/403/429, CSRF) never reaches `DeprecationInterceptor` — guards run
  before interceptors in Nest's pipeline — so a decorated-but-guarded route carries no deprecation
  headers on a rejected call. That is a pre-existing shape of Nest's pipeline, not something this
  feature could special-case; documented plainly in [Make an endpoint
  deprecated](../guides/make-an-endpoint-deprecated.md) rather than left for someone to discover.
- These headers are not on the CORS Access-Control-Expose-Headers safelist and this application
  sets none, so a browser `fetch()` client cannot read `Deprecation`/`Sunset`/`Link` from a
  cross-origin response today — the same pre-existing gap `x-request-id` already has. Fixing it is
  a CORS configuration change, out of scope here, and noted in the guide rather than silently left
  as a surprise.
- Rejected: **deriving the dates from config** (an env var per route, or a single
  `DEPRECATED_ROUTES_JSON` blob). Rejected above: no natural per-route key, changeable without
  review, and diverges from "this route's timeline is the same in every environment."
- Rejected: **a boolean `Deprecation` value** (`Deprecation: true`, as some pre-RFC-9745
  implementations of the header did). RFC 9745 §3.3.7 defines the field's value as a Structured
  Fields Date Item; there is no boolean form to opt into, so supporting one would produce a header
  no compliant client or library could parse.

## Also see

- [Make an endpoint deprecated](../guides/make-an-endpoint-deprecated.md) — usage, the retirement
  policy, and the honest limitations above in full.
- [`docs/architecture/http-interface.md`](../architecture/http-interface.md) § Deprecation.
