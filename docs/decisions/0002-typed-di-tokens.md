# 0002. Typed Symbol tokens for DI

- Status: Accepted
- Date: 2026-09-17

## Context

Ports are TypeScript interfaces and need runtime tokens. Plain `Symbol.for('X')` tokens carry no type, so binding the wrong adapter compiled and failed only at runtime.

Alternatives considered:

- **Abstract classes as ports:** no separate token, but the port becomes a runtime class in application/domain.
- **Plain symbols:** simple, unchecked.

## Decision

`createToken<Port>(name)` in `@shared` returns `TypedToken<Port>`, a symbol with a phantom type. `ProviderFactory` overloads use `NoInfer<T>` so the token decides the type and a mismatched class, factory, value or alias is a compile error. Plain string tokens (Nest's `APP_*`) remain unchecked.

## Consequences

- Wrong bindings fail `pnpm typecheck` / build.
- Ports stay pure interfaces; tokens are framework-free, so domain can declare them.
- `provider.factory.spec.ts` guards the behaviour with `@ts-expect-error`; Jest doesn't type-check, so `pnpm typecheck` must run in CI.
