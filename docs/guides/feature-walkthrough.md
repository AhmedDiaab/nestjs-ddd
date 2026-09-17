# Feature walkthrough: Tickets

Builds a complete feature through every layer. Each step links to a focused guide with the full code. The finished code (compiled, linted and tested against this template) is on the `example/tickets` branch:

```bash
git diff feat/oracle-backport..example/tickets --stat
```

## What we build

| Endpoint                                   | Use case             | Reads/writes through                 |
| ------------------------------------------ | -------------------- | ------------------------------------ |
| `POST /v1/tickets` `{ title }`             | `OpenTicketUseCase`  | `TicketRepository` (domain port)     |
| `POST /v1/tickets/:id/close`               | `CloseTicketUseCase` | `TicketRepository`                   |
| `GET /v1/tickets/:id`                      | `GetTicketUseCase`   | `TicketQueryPort` (application port) |
| `GET /v1/tickets?status&page&size&orderBy` | `ListTicketsUseCase` | `TicketQueryPort`                    |

Rules: a title is 1 to 200 characters after trimming; a closed ticket can't be closed again. Every database call runs as the authenticated user (Oracle `CLIENT_IDENTIFIER`).

## Files

```text
src/domain/tickets/ticket-title.vo.ts                        1. value object
src/domain/tickets/ticket.errors.ts                          1. domain error (409)
src/domain/tickets/ticket.entity.ts                          1. aggregate
src/domain/repositories/ticket.repository.ts                 2. repository port + token
src/application/ports/queries/ticket.query.port.ts           3. query port + read model + token
src/application/use-cases/tickets/*.use-case.ts              4. use cases
src/application/application.module.ts                        4. register use cases
src/infrastructure/database/mappers/ticket.mapper.ts         5. row ↔ domain/read model
src/infrastructure/database/repositories/oracle-ticket.repository.ts   5. repository adapter
src/infrastructure/database/queries/ticket-query.dao.ts      6. query adapter
src/infrastructure/database/database.module.ts               5-6. bind tokens
src/interface/http/schemas/ticket.schema.ts                  7. Zod schemas
src/interface/http/controllers/tickets.controller.ts         7. controller
src/interface/interface.module.ts                            7. register controller
test/fakes/in-memory-tickets.ts                              8. fakes
test/unit/**, test/e2e/tickets.e2e-spec.ts                   8. tests
```

## Steps

0. **Table.** Create the database objects. If another team owns the schema, skip this: get the definitions and contract from them and follow [Work with a database you don't own](work-with-a-database-you-dont-own.md).
    ```sql
    CREATE TABLE tickets (
        id          VARCHAR2(36)  PRIMARY KEY,
        title       VARCHAR2(200) NOT NULL,
        status      VARCHAR2(10)  NOT NULL CHECK (status IN ('open', 'closed')),
        created_by  VARCHAR2(64)  NOT NULL,
        created_at  TIMESTAMP     NOT NULL,
        closed_at   TIMESTAMP
    );
    CREATE INDEX tickets_status_created_ix ON tickets (status, created_at DESC);
    ```
1. **Domain model.** `TicketTitle`, `TicketAlreadyClosedError`, `Ticket`. See [Add a value object and entity](add-value-object-and-entity.md).
2. **Repository port.** `TicketRepository` + `TicketRepositoryToken` in `src/domain/repositories`. See [Add a repository](add-repository.md#1-define-the-port-in-the-domain).
3. **Query port.** `TicketQueryPort`, `TicketSummary` + token in `src/application/ports/queries`. See [Add a query port and DAO](add-query-port-and-dao.md#1-define-the-port-and-read-model).
4. **Use cases.** Open, close, get, list; register them in `ApplicationModule`. See [Add a use case](add-use-case.md).
5. **Repository adapter.** Mapper + `OracleTicketRepository`, bound in `DatabaseModule`. See [Add a repository](add-repository.md#2-map-rows).
6. **Query adapter.** `TicketQueryDao`, bound in `DatabaseModule`. See [Add a query port and DAO](add-query-port-and-dao.md#2-implement-the-dao).
7. **HTTP.** Schemas, `TicketsController`, registered before `FallbackController`. See [Add a controller](add-controller.md).
8. **Tests.** Domain, use cases with fakes, adapter with a mocked connection, e2e with overridden providers. See [Write tests](write-tests.md).
9. **Verify.**
    ```bash
    pnpm verify
    ```

## Checklist

- [ ] Domain code imports only `@shared` and domain files.
- [ ] Use cases inject ports by token and return `Result` for expected failures.
- [ ] Every port has a token created with `createToken<Port>()` and a binding in an infrastructure module.
- [ ] SQL uses binds; `ORDER BY` comes from a whitelist map.
- [ ] Repositories/DAOs pass `contextUser: options?.actor` and a `tag`.
- [ ] Rows are mapped in infrastructure with named columns (`OUT_FORMAT_OBJECT`).
- [ ] Controller validates with `@UseZodHttp`, reads `@Validated`, passes `user.username`.
- [ ] New controller registered before `FallbackController`.
- [ ] Tests for domain rules, use-case failures, adapter SQL/binds, and the HTTP statuses.
- [ ] `pnpm verify` passes.
