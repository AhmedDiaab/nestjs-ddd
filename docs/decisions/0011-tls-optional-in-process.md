# 0011. Optional in-process TLS, off by default

- Status: Accepted
- Date: 2026-09-19

## Context

Nothing in this template terminates TLS today: `NestFactory.create` gets no `httpsOptions`,
`app.listen(port)` speaks plain HTTP, and every doc — [Migrate a legacy
service](../guides/migrate-a-legacy-service.md) in particular — assumes a load balancer, VIP or
reverse proxy terminates TLS in front of the app. That is the right default for the deployments
this template targets first: behind a load balancer, certificate rotation, ALPN/HTTP2 negotiation
and TLS version policy all become the terminator's job, and duplicating that inside the app adds a
second place to keep in sync for no benefit.

It stops being the right default the moment there is no terminator — chiefly the Windows service
install (`start-service.ps1`), which drops `node dist/main.js` straight onto a host with no
reverse proxy in front of it by default. Those deployments need the app to be able to speak HTTPS
itself, without that becoming the default for everyone else.

## Decision

- **`TLS_ENABLED` defaults to `false`.** Terminating at the proxy stays the documented default
  path; TLS is opt-in for the terminate-here case only. `TRUST_PROXY` (already in the template,
  `src/main.ts`) is the other half of this decision: it says "an upstream already terminated TLS
  for me", `TLS_ENABLED` says "I terminate TLS myself" — the two are normally opposites of each
  other, and both are documented together in `docs/architecture/operations.md` § TLS and
  `docs/architecture/configuration.md` § TLS.
- **The key/cert/CA files are read once, at bootstrap, before `NestFactory.create`.** `src/main.ts`
  calls `loadConfig()` directly — the same pure function `ConfigModule`'s `EnvConfigAdapter` calls
  from DI — because `NestFactory.create` is what builds the HTTP(S) server; there is no way to
  hand it a certificate after the fact, and no `ConfigPort` exists yet at that point since DI
  hasn't been assembled. Every other config read in `main.ts` still goes through the injected
  `ConfigPort`, exactly as before — this is a deliberately narrow, single exception, not a new
  pattern, and it is written as one clean call so a later branch (cluster mode, which needs the
  same early read) can reuse it rather than growing a second ad hoc `process.env` read.
- **A bad or missing path fails at boot, not on the first HTTPS request.** `loadTlsOptions`
  (`src/infrastructure/tls/load-tls-options.ts`) reads the files synchronously during that same
  early read and throws `InvalidConfigError` — the same type, and the same `main.ts` catch block,
  that already handles a bad `.env` — naming the path only, never the file's contents (the key
  file is sensitive; the error must never leak it). A silently misconfigured TLS deployment would
  otherwise stay "up" (the process is alive) while unable to accept a single request, which is a
  worse failure mode than refusing to start.
- **The TLS schema (`src/infrastructure/config/schemas/tls.schema.ts`) requires `keyFile`/
  `certFile` only when `enabled`**, via the same `.superRefine()` cross-field pattern
  `http.schema.ts` already uses for `THROTTLE_REDIS_URL`, so `TLS_ENABLED=true` without a
  certificate fails the same way any other invalid config does — at `loadConfig()`, before either
  the file-read or the server ever runs.

## Consequences

- Turning TLS on costs one env var plus two file paths; turning it off (the default) costs
  nothing and changes no other code path.
- `main.ts` ends up reading config twice at startup: once directly via `loadConfig()` for
  `httpsOptions`, and once more when Nest constructs `ConfigModule`'s `EnvConfigAdapter` through
  DI. Both reads are pure and cheap (env → Zod). `EnvConfigAdapter`'s constructor now optionally
  accepts an already-loaded `AppConfig`, so the bootstrap read is reused — not reparsed a second
  time — to build the `ConfigPort` that `loadTlsOptions` needs; the DI-constructed instance still
  loads its own, as before.
- No e2e test generates a certificate in-process — that would need a dependency this template
  doesn't otherwise carry, just to exercise a Node built-in.
  `test/unit/infrastructure/tls/load-tls-options.spec.ts` covers the loader against real temporary
  files instead, and `docs/architecture/operations.md` § TLS documents the manual `openssl`/`curl`
  verification recipe.
- Rejected: **a second plain-HTTP listener that redirects to HTTPS.** That is the standard shape
  for a public-facing server with nothing in front of it at all, but it is wrong here: behind a
  load balancer that already terminates TLS and redirects HTTP to HTTPS at the edge, a second
  in-app redirect is redundant at best and, if the forwarded scheme isn't threaded through
  correctly, can loop. An app that terminates its own TLS in this template already has no proxy in
  front of it — that is the only case `TLS_ENABLED` is for — so there is no plain-HTTP edge
  traffic to redirect in the first place; a client that dials plain HTTP at a TLS-enabled instance
  simply fails the TLS handshake, the same as any other HTTPS-only server.
