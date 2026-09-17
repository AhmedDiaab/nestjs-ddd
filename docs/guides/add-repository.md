# Add a repository

A repository loads and saves an **aggregate**. The interface is part of the domain; the Oracle implementation is infrastructure.

| Piece                                | Location                                                               |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `TicketRepository` interface + token | `src/domain/repositories/ticket.repository.ts`                         |
| Row mapper                           | `src/infrastructure/database/mappers/ticket.mapper.ts`                 |
| `OracleTicketRepository`             | `src/infrastructure/database/repositories/oracle-ticket.repository.ts` |
| Binding                              | `src/infrastructure/database/database.module.ts`                       |

For read-only lists and details, use a query port instead: [Add a query port and DAO](add-query-port-and-dao.md). Why the interface isn't in infrastructure: [Dependency injection → Where ports live](../architecture/dependency-injection.md#where-ports-live).

## 1. Define the port in the domain

```ts
// src/domain/repositories/ticket.repository.ts
import { createToken } from '@shared';
import type { Ticket } from '../tickets';

export type RepositoryOptions = {
    /** Who performs the change (username). Persisted for audit; Oracle adapters send it as CLIENT_IDENTIFIER. */
    actor?: string;
};

/** Collection-like access to the Ticket aggregate. Implemented in infrastructure. */
export interface TicketRepository {
    nextId(): string;
    findById(id: string, options?: RepositoryOptions): Promise<Ticket | undefined>;
    save(ticket: Ticket, options?: RepositoryOptions): Promise<void>;
}

export const TicketRepositoryToken = createToken<TicketRepository>('TicketRepository');
```

```ts
// src/domain/repositories/index.ts
export {
    type RepositoryOptions,
    type TicketRepository,
    TicketRepositoryToken,
} from './ticket.repository';
```

Rules:

- Methods speak domain types only: no `Connection`, SQL, source keys or read models.
- Keep it collection-like (`findById`, `save`, `nextId`, maybe `exists`/`delete`). Queries for screens go to query ports.
- `actor` is the only persistence-adjacent option; the adapter turns it into `contextUser`.

## 2. Map rows

```ts
// src/infrastructure/database/mappers/ticket.mapper.ts
import type { TicketSummary } from '@application/ports';
import { Ticket, TicketTitle, type TicketStatus } from '@domain';

/** Column names as returned with outFormat OBJECT (Oracle upper-cases unquoted aliases). */
export type TicketRow = {
    ID: string;
    TITLE: string;
    STATUS: TicketStatus;
    CREATED_BY: string;
    CREATED_AT: Date;
    CLOSED_AT: Date | null;
};

export const TicketMapper = {
    toDomain(row: TicketRow): Ticket {
        const title = TicketTitle.create(row.TITLE);
        if (!title.ok) {
            // stored data violates a domain rule: fail loudly instead of hiding it
            throw new Error(`Corrupt ticket row ${row.ID}: ${title.error.message}`);
        }
        return Ticket.restore(row.ID, {
            title: title.value,
            status: row.STATUS,
            createdBy: row.CREATED_BY,
            createdAt: row.CREATED_AT,
            closedAt: row.CLOSED_AT ?? undefined,
        });
    },

    toBinds(ticket: Ticket) {
        return {
            id: ticket.id,
            title: ticket.title.value,
            status: ticket.status,
            createdBy: ticket.createdBy,
            createdAt: ticket.createdAt,
            closedAt: ticket.closedAt ?? null,
        };
    },

    toSummary(row: TicketRow): TicketSummary {
        return {
            id: row.ID,
            title: row.TITLE,
            status: row.STATUS,
            createdBy: row.CREATED_BY,
            createdAt: row.CREATED_AT.toISOString(),
            closedAt: row.CLOSED_AT ? row.CLOSED_AT.toISOString() : null,
        };
    },
};
```

- Use named columns (`OUT_FORMAT_OBJECT`); never index rows positionally.
- Rehydrate with `Ticket.restore`, not the business factory.
- Bind `null`, not `undefined`, for empty columns.

## 3. Implement the repository

```ts
// src/infrastructure/database/repositories/oracle-ticket.repository.ts
import { randomUUID } from 'node:crypto';
import type { RepositoryOptions, Ticket, TicketRepository } from '@domain';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { TicketMapper, type TicketRow } from '@infrastructure/database/mappers/ticket.mapper';
import { DatabaseSources } from '@infrastructure/database/sources';
import oracledb, { type Connection } from 'oracledb';

const SELECT_BY_ID = `
    SELECT id, title, status, created_by, created_at, closed_at
    FROM tickets
    WHERE id = :id
`;

const UPSERT = `
    MERGE INTO tickets t
    USING (SELECT :id AS id FROM dual) s
    ON (t.id = s.id)
    WHEN MATCHED THEN UPDATE SET
        t.title = :title,
        t.status = :status,
        t.closed_at = :closedAt
    WHEN NOT MATCHED THEN INSERT (id, title, status, created_by, created_at, closed_at)
        VALUES (:id, :title, :status, :createdBy, :createdAt, :closedAt)
`;

export class OracleTicketRepository implements TicketRepository {
    constructor(private readonly db: ConnectionProvider) {}

    nextId(): string {
        return randomUUID();
    }

    findById(id: string, options?: RepositoryOptions): Promise<Ticket | undefined> {
        return this.db.withConnection<Ticket | undefined, Connection>(
            DatabaseSources.main,
            async (connection) => {
                const { rows } = await connection.execute<TicketRow>(
                    SELECT_BY_ID,
                    { id },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT },
                );
                const [row] = rows ?? [];
                return row ? TicketMapper.toDomain(row) : undefined;
            },
            { contextUser: options?.actor, tag: 'tickets.findById' },
        );
    }

    save(ticket: Ticket, options?: RepositoryOptions): Promise<void> {
        // transaction(): commit on success, rollback on error, one connection
        return this.db.transaction<void, Connection>(
            DatabaseSources.main,
            async (connection) => {
                await connection.execute(UPSERT, TicketMapper.toBinds(ticket));
            },
            { contextUser: options?.actor, tag: 'tickets.save' },
        );
    }
}
```

- Writes go through `transaction()`, which commits on success (`autoCommit` defaults to off).
- Always pass `contextUser` and a `tag`.
- Duplicate keys become `ConflictError` (409) and connection problems `DatabaseConnectionError` (503) automatically; see [Database → Error mapping](../architecture/database.md#error-mapping).
- A different source? Add a key to `src/infrastructure/database/sources.ts` ([Add a database source](add-database-source.md)).

## 4. Bind the token

```ts
// src/infrastructure/database/database.module.ts
import { TicketRepositoryToken } from '@domain';
import { OracleTicketRepository } from '@infrastructure/database/repositories/oracle-ticket.repository';

providers: [
    // ...
    ProviderFactory.factory(
        TicketRepositoryToken,
        (db: IConnectionProvider) => new OracleTicketRepository(db),
        [ConnectionProviderToken],
    ),
],
exports: [/* ... */, TicketRepositoryToken],
```

`DatabaseModule` is `@Global`, so any use case can inject `TicketRepositoryToken`. The typed token makes a wrong class a compile error.

## 5. Test

- Use cases: in-memory fake of `TicketRepository`.
- Adapter: mocked `ConnectionProvider`, asserting SQL, binds and options.

See [Write tests](write-tests.md).

## Multiple aggregates in one transaction

`ConnectionProvider.transaction` spans one callback on one source. If a use case must save several aggregates atomically, add an application `UnitOfWork` port whose infrastructure implementation opens one transaction and hands repositories the same connection. Don't pass connections through use cases.
