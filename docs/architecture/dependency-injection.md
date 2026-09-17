# Dependency injection

## Why tokens

TypeScript interfaces don't exist at runtime, so Nest can't inject "a `ConfigPort`". Each port gets a **token**, a runtime value that names it:

```ts
// src/application/ports/tokens.ts
export const ConfigPortToken = createToken<ConfigPort>('ConfigPort');

// consumer
constructor(@Inject(ConfigPortToken) private readonly config: ConfigPort) {}

// binding (infrastructure)
ProviderFactory.class(ConfigPortToken, EnvConfigAdapter)
```

## Typed tokens

`src/shared/typed-token.ts`:

```ts
export type TypedToken<T> = symbol & { readonly [tokenType]?: T }; // phantom type, no runtime cost
export function createToken<T>(name: string): TypedToken<T> {
    return Symbol.for(name) as TypedToken<T>;
}
```

- The token carries the port type, so `ProviderFactory` can check the binding:
    ```ts
    ProviderFactory.class(ConfigPortToken, EnvConfigAdapter); // ok
    ProviderFactory.class(ConfigPortToken, PinoLoggerAdapter); // compile error: No overload matches this call
    ```
- `Symbol.for(name)` returns the same symbol for the same name, even across duplicated module instances (Jest, hot reload). Use unique, descriptive names (`'TicketRepository'`, not `'Repo'`).
- `createToken` lives in `@shared`, which has no framework imports, so **domain** code can declare tokens too.

## `ProviderFactory`

`src/common/factories/provider.factory.ts`. All methods are overloaded: with a `TypedToken<T>`, the implementation must produce `T` (`NoInfer<T>` makes the token decide `T`). With a plain `string` token (Nest's `APP_GUARD`, `APP_FILTER`…) there is no check.

| Method                        | Nest provider | Use for                                                                 |
| ----------------------------- | ------------- | ----------------------------------------------------------------------- |
| `class(token, Class)`         | `useClass`    | adapters with injectable constructors (`@Inject(...)` params)           |
| `factory(token, fn, inject)`  | `useFactory`  | adapters constructed manually, e.g. DAOs that take `ConnectionProvider` |
| `value(token, value)`         | `useValue`    | constants, test fakes                                                   |
| `existing(token, otherToken)` | `useExisting` | one adapter exposed under two ports                                     |

```ts
// DAO/repository binding pattern (src/infrastructure/database/database.module.ts)
ProviderFactory.factory(
    TicketRepositoryToken,
    (db: ConnectionProvider) => new OracleTicketRepository(db),
    [ConnectionProviderToken],
);
```

Depend on `ConnectionProviderToken`, not `PoolManager`: the factory behind that token creates and pings the pools first, so DAOs are only built once the database layer is ready.

`DIToken` (`src/common/type-utils.ts`) is just the _type_ `string | symbol` used in provider typings; you don't create values of it.

## Where ports live

A port lives with the layer that **calls** it, not the layer that implements it.

| Port kind                    | Signature speaks…                    | Lives in                                 | Example                                     |
| ---------------------------- | ------------------------------------ | ---------------------------------------- | ------------------------------------------- |
| Aggregate repository         | domain types (`Ticket`, ids)         | `src/domain/repositories/`               | `TicketRepository`, `TicketRepositoryToken` |
| Query / read port            | read models for responses            | `src/application/ports/queries/`         | `TicketQueryPort`                           |
| Gateway / cross-cutting port | app concerns (config, logging, mail) | `src/application/ports/`                 | `ConfigPort`, `LoggerPort`                  |
| Infrastructure contract      | `Connection`, source keys, pools     | `src/infrastructure/database/contracts/` | `ConnectionProvider`                        |

Quick test: if the interface mentions `Connection`, SQL, `sourceKey`, `Lob` or driver errors, it is an infrastructure contract and only DAOs/repositories may use it. If it speaks business terms, it belongs to domain or application, and infrastructure implements it.

Putting use-case ports in infrastructure (e.g. `infrastructure/database/dao-ports`) makes application import infrastructure. That reverses the dependency, leaks driver types (`Lob`, `DBError`) into use cases, invites import cycles (`forwardRef`), and breaks the lint rules.

Token placement:

- **Cross-cutting ports** (`ConfigPort`, `LoggerPort`): `src/application/ports/tokens.ts`.
- **Feature ports**: in the same file as the port (`ticket.repository.ts` exports `TicketRepositoryToken`).

## Scopes

All providers are singletons. Don't use `Scope.REQUEST`: it makes every dependent provider request-scoped too (slow, and unusable at boot/shutdown).

- **Per-request data** (current user, request id) is passed explicitly as use-case input.
- **Logs** still carry the request id: nestjs-pino binds the request logger through `AsyncLocalStorage`.

## Related

- [Add a repository](../guides/add-repository.md)
- [Decision 0002: typed tokens](../decisions/0002-typed-di-tokens.md)
