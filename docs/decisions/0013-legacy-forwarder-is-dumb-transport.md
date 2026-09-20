# 0013. The legacy forwarder is dumb transport

- Status: Accepted
- Date: 2026-09-20

## Context

[Migrate a legacy service](../guides/migrate-a-legacy-service.md) lists five ways to get
route-by-route safety when there is no proxy the team controls. Option B — "new service in
front" — is the one where this template's own deployment owns the forwarding: the VIP now points
at this service, migrated routes are served normally, and everything else has to reach the legacy
service that used to answer directly. Until this decision the guide only described the shape of
that forwarder in prose; nothing shipped, so every team choosing option B re-implemented the same
small proxy, with the same header and timeout mistakes, on their own.

The requirement is narrow on purpose: pass bytes through, unmodified, for a shrinking list of
paths, until the list is empty and the hop is deleted. That narrowness is what makes "dumb
transport" the right frame — this is not a second outbound-HTTP client, and treating it like one
(status mapping, retries, a circuit breaker) would fight the one property that makes option B safe
to run: whatever the legacy service does today, right or wrong, the client sees unchanged.

## Decision

- **Forward only configured prefixes, never "anything this app doesn't recognise."** `forwardPrefixes`
  (`LEGACY_FORWARD_PREFIXES`, `src/infrastructure/config/schemas/legacy.schema.ts`) is an explicit
  allow-list matched by `matchesLegacyPrefix`
  (`src/infrastructure/legacy/matches-prefix.util.ts`) — exact match or a sub-path, never a bare
  string prefix (`/v1/orders-archive` does not match `/v1/orders`). `FallbackController` keeps
  answering 404 for every other unmatched path. The alternative — forward whatever this app's own
  router doesn't claim — would silently forward typos, probes and future routes nobody configured,
  and would make "what does this service actually own" unanswerable without reading the legacy
  service's routing too. A deployment with nothing left to forward simply sets
  `LEGACY_FORWARD_PREFIXES` to empty (or `LEGACY_FORWARD_ENABLED=false`) and deletes the hop —
  the same one-line-per-route shrink the guide has always described for option C.
- **Wired in `src/main.ts`, the composition root, not as a Nest middleware in `src/interface`.**
  The ESLint layer fence forbids `src/interface/**` from importing `@infrastructure`
  (`eslint.config.mjs`), and the forwarder is infrastructure by every definition in this codebase:
  it owns a `node:http`/`node:https` client, a target URL and a timeout, the same shape as
  `FetchHttpClient`. `main.ts` already imports infrastructure directly (`loadTlsOptions`,
  `EnvConfigAdapter`, cluster wiring), so this is one more line there, not a new exception. The
  consequence is placement: it runs via `app.use()` **before** Nest's own middleware stack,
  including `RequestContextMiddleware` — so the forwarder cannot read the request context for a
  correlation id the way `FetchHttpClient` does. It resolves its own instead, straight from the
  configured request-id header (`isSafeCorrelationId`, same bound `@shared` uses everywhere else a
  caller-supplied id reaches a log line), generating one when the caller sent none.
- **The legacy status passes through untouched — 2xx, 4xx and 5xx alike.** This is the one place
  in the codebase that deliberately does not follow [Call another
  service](../guides/call-another-service.md): a gateway adapter maps expected upstream statuses to
  a `Result` and turns everything else into a 503, because the gateway is expected to understand
  the upstream's contract. The forwarder understands nothing about the legacy service's routes —
  that is the whole point of option B, it is a hop, not a client with an opinion. Turning a legacy
  500 into this app's 503 would be a lie: the legacy service answered, correctly by its own
  behaviour (bug-for-bug compatible is the goal during a strangler migration — see
  [§4](../guides/migrate-a-legacy-service.md#4-prove-it-matches)), and rewriting that status would
  make the client's retry/alerting logic diverge from what it did yesterday, for no operational
  reason. Only a transport failure on this hop specifically is this service's own problem: a
  connection refused, unresolved DNS or reset socket becomes 502 (this hop is broken), and a
  legacy call that outlives `LEGACY_TIMEOUT_MS` becomes 504 (this hop gave up waiting) —
  `legacy-forwarder.ts`. Both are logged as `legacy.forward.failed` with the method, path and
  status only, never a body or header (they can carry tokens, cookies or PII).
- **Streams with `node:http`/`node:https`, not `FetchHttpClient`.** `FetchHttpClient`
  (`src/infrastructure/http/fetch-http.client.ts`) calls `response.text()` and JSON-parses the
  result (`readResponse`) — correct for a gateway that needs a typed body to map, wrong for a hop
  whose entire job is "don't look at the bytes." Buffering the body would also cap what a
  forwarded route can carry at whatever this service holds in memory per in-flight request, for
  traffic this service does not otherwise need to understand at all. `LegacyForwarder` instead
  pipes the inbound `IncomingMessage` straight into the outbound `ClientRequest`
  (`req.pipe(outbound)`) and the upstream's response straight into the outbound `ServerResponse`
  (`upstream.pipe(res)`), so memory use for a forwarded request is independent of body size. It is
  mounted **before** the body parsers (`app.useBodyParser(...)` in `main.ts`) for the same reason:
  by the time Express would have parsed and discarded the original bytes, this hop needs them
  intact.
- **`forward-headers.util.ts` strips only the eight hop-by-hop headers** (`connection`,
  `keep-alive`, `transfer-encoding`, `upgrade`, `proxy-authenticate`, `proxy-authorization`, `te`,
  `trailer` — RFC 7230 §6.1) **on the way to the legacy service**, appends this hop to
  `X-Forwarded-For`, sets `X-Forwarded-Proto`/`X-Forwarded-Host`, and decides `Host` from
  `preserveHostHeader` (default off: the legacy service usually expects its own hostname, not this
  app's). `Authorization`, cookies and the request-id header are ordinary headers here and pass
  through unfiltered, same as everything else not on that list. The response direction is not
  filtered at all — the client sees the legacy service's headers exactly as it sent them, matching
  the "bytes through unchanged" rule and what the characterisation tests in
  [§4](../guides/migrate-a-legacy-service.md#4-prove-it-matches) compare against.

## Consequences

- Turning this on costs four env vars (`LEGACY_FORWARD_ENABLED`, `LEGACY_TARGET_URL`,
  `LEGACY_FORWARD_PREFIXES`, plus the lower-risk `LEGACY_TIMEOUT_MS`/`LEGACY_PRESERVE_HOST_HEADER`
  defaults); leaving it off (the default) changes no other code path, verified by the full
  single-process test suite passing with it unset.
- `docs/guides/migrate-a-legacy-service.md` § option B now points here instead of describing a
  forwarder to write from scratch; `docs/architecture/configuration.md` § Legacy forwarding and
  `.env.example` document the four variables.
- A team on option C ("legacy forwards") gets nothing from this — that forwarder lives in the
  legacy service, outside this codebase, and is unaffected.
- Per [decision 0015](0015-shared-files-between-the-two-templates.md), this number is reserved in
  `nestjs-ddd-lean`'s sequence but not used there: the leaner template does not ship this feature.
- Rejected: **`http-proxy-middleware` (or a similar reverse-proxy dependency).** It solves the
  streaming and header-forwarding mechanics this decision implements by hand, but it is a general
  reverse proxy — WebSocket upgrades, path rewriting, response interception hooks — for a
  requirement that is deliberately narrower: a fixed list of prefixes, one upstream, one timeout,
  transport failures mapped to exactly two statuses. Depending on it would mean documenting and
  pinning a dependency whose surface area this feature does not use, for logic
  (`matches-prefix.util.ts`, `forward-headers.util.ts`) that is a few dozen lines and easier to
  read, test and keep in sync with `docs/decisions/` than to configure around.
- Rejected: **reusing `FetchHttpClient`.** Covered above (buffers the whole body via
  `response.text()`); the reliability behaviour it adds on top — retries, a circuit breaker,
  `Retry-After` — is also the wrong behaviour here. Retrying a non-idempotent legacy call this
  service does not understand risks a double side effect the gateway pattern is careful never to
  cause without an explicit `idempotent: true` and a documented reason; a forwarder has no
  business making that call on the caller's behalf.
- Not done here: no **circuit breaker** or **retry** for the legacy hop. A struggling legacy
  service should be visible as failures at its own rate, not smoothed over by a hop that doesn't
  know which of its routes are safe to repeat; an operator watching `legacy.forward.failed` sees
  the real picture. This can be revisited if option B outlives the migration long enough for that
  trade-off to change.
