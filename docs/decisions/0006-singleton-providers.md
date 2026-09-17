# 0006. Singleton providers; no request-scoped DI

- Status: Accepted
- Date: 2026-09-17

## Context

The template's logger adapter and exception filter were `Scope.REQUEST`. In Nest, a request-scoped provider makes every dependent provider request-scoped: pool managers and DAOs would be rebuilt per request and couldn't be used at boot or shutdown.

## Decision

- All providers are singletons.
- Request data (user, ids) is passed explicitly as use-case input.
- Log correlation relies on nestjs-pino's `AsyncLocalStorage` binding, which works from singletons.

## Consequences

- Predictable lifecycle and performance.
- Request context is explicit in signatures (`username`, `actor`) rather than implicit.
