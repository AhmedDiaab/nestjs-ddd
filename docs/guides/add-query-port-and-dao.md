# Add a query port and DAO

For reads shaped for responses (details, lists, reports, stored-procedure outputs) that don't need the domain model.

| Piece                   | Location                                                  |
| ----------------------- | --------------------------------------------------------- |
| Port, read model, token | `src/application/ports/queries/<name>.query.port.ts`      |
| DAO                     | `src/infrastructure/database/queries/<name>-query.dao.ts` |
| Binding                 | `src/infrastructure/database/database.module.ts`          |

## 1. Define the port and read model

```ts
// src/application/ports/queries/ticket.query.port.ts
import { createToken } from '@shared';
import type { PageEnvelope } from '@shared/pagination';
import type { QueryOptions } from './query-options';

/** Read model: shaped for API responses, not a domain entity. */
export type TicketSummary = {
    id: string;
    title: string;
    status: 'open' | 'closed';
    createdBy: string;
    createdAt: string; // ISO-8601
    closedAt: string | null;
};

export type TicketListFilter = {
    status?: 'open' | 'closed';
};

export type TicketSort = 'createdAt:desc' | 'createdAt:asc' | 'title:asc' | 'title:desc';

export type PageRequest<Sort extends string> = {
    page: number; // 1-based
    size: number;
    orderBy: Sort;
};

export interface TicketQueryPort {
    findById(id: string, options?: QueryOptions): Promise<TicketSummary | undefined>;
    list(
        filter: TicketListFilter,
        page: PageRequest<TicketSort>,
        options?: QueryOptions,
    ): Promise<PageEnvelope<TicketSummary>>;
}

export const TicketQueryPortToken = createToken<TicketQueryPort>('TicketQueryPort');
```

Export it from `src/application/ports/queries/index.ts` and add the new names to the `./queries` export list in `src/application/ports/index.ts` (named exports only, no `export *`). `QueryOptions` (`{ actor }`) is shared by all query ports in `ports/queries/query-options.ts`.

Rules:

- Read models are plain JSON-safe types: ISO strings for dates, `null` for empty values.
- Sort options are a closed union, never a free string.
- Shared types like `PageRequest`/`QueryOptions` can move to a common file when a second query port needs them.

## 2. Implement the DAO

```ts
// src/infrastructure/database/queries/ticket-query.dao.ts
import type {
    PageRequest,
    QueryOptions,
    TicketListFilter,
    TicketQueryPort,
    TicketSort,
    TicketSummary,
} from '@application/ports';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { TicketMapper, type TicketRow } from '@infrastructure/database/mappers/ticket.mapper';
import { DatabaseSources } from '@infrastructure/database/sources';
import type { PageEnvelope } from '@shared/pagination';
import oracledb, { type Connection } from 'oracledb';

/**
 * Sort keys map to fixed SQL: never interpolate client input into ORDER BY.
 * Bind names avoid SQL keywords (:offset/:fetch can raise ORA-01745).
 */
const ORDER_BY: Record<TicketSort, string> = {
    'createdAt:desc': 'created_at DESC, id DESC',
    'createdAt:asc': 'created_at ASC, id ASC',
    'title:asc': 'title ASC, id ASC',
    'title:desc': 'title DESC, id DESC',
};

const COLUMNS = 'id, title, status, created_by, created_at, closed_at';

export class TicketQueryDao implements TicketQueryPort {
    constructor(private readonly db: ConnectionProvider) {}

    findById(id: string, options?: QueryOptions): Promise<TicketSummary | undefined> {
        return this.db.withConnection<TicketSummary | undefined, Connection>(
            DatabaseSources.main,
            async (connection) => {
                const { rows } = await connection.execute<TicketRow>(
                    `SELECT ${COLUMNS} FROM tickets WHERE id = :id`,
                    { id },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT },
                );
                const [row] = rows ?? [];
                return row ? TicketMapper.toSummary(row) : undefined;
            },
            { contextUser: options?.actor, tag: 'tickets.query.findById' },
        );
    }

    list(
        filter: TicketListFilter,
        page: PageRequest<TicketSort>,
        options?: QueryOptions,
    ): Promise<PageEnvelope<TicketSummary>> {
        const sql = `
            SELECT ${COLUMNS}
            FROM tickets
            WHERE (:status IS NULL OR status = :status)
            ORDER BY ${ORDER_BY[page.orderBy]}
            OFFSET :rowOffset ROWS FETCH NEXT :rowLimit ROWS ONLY
        `;

        return this.db.withConnection<PageEnvelope<TicketSummary>, Connection>(
            DatabaseSources.main,
            async (connection) => {
                const { rows = [] } = await connection.execute<TicketRow>(
                    sql,
                    {
                        status: filter.status ?? null,
                        rowOffset: (page.page - 1) * page.size,
                        rowLimit: page.size + 1, // one extra row tells us if there is a next page
                    },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT },
                );
                return {
                    data: rows.slice(0, page.size).map((row) => TicketMapper.toSummary(row)),
                    meta: { hasNext: rows.length > page.size, hasPrev: page.page > 1 },
                };
            },
            { contextUser: options?.actor, tag: 'tickets.query.list' },
        );
    }
}
```

SQL rules:

- **Values are always bound** (`:name`). The only interpolation allowed is fixed SQL fragments from constants (column lists, whitelisted `ORDER BY`).
- Avoid bind names that are SQL keywords (`:offset`, `:fetch`, `:date`, `:level`, `:size`...): they raise `ORA-01745`.
- `OFFSET ... FETCH` requires Oracle 12c+. Always order deterministically (append the id).
- Fetch `size + 1` rows to compute `hasNext` without a `COUNT(*)`.
- Large text: `ORACLE_FETCH_AS_STRING=CLOB` globally, or `fetchInfo` per query, or `lobToString` from `@infrastructure/database/utils` for OUT binds.
- Optional filter pattern: `(:status IS NULL OR status = :status)`. For heavy tables, build the `WHERE` from fixed fragments instead so indexes are used.

### Stored procedures

```ts
const { outBinds } = await connection.execute<{ status: string; feedback: Lob }>(
    `BEGIN delete_site(p_site_name => :siteName, o_status => :status, o_feedback => :feedback); END;`,
    {
        siteName,
        status: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
        feedback: { dir: oracledb.BIND_OUT, type: oracledb.CLOB },
    },
);
const feedback = await lobToString(outBinds?.feedback);
```

Wrap procedures that change data in `transaction()` unless the procedure commits itself.

## 3. Bind the token

```ts
// src/infrastructure/database/database.module.ts
ProviderFactory.factory(
    TicketQueryPortToken,
    (db: IConnectionProvider) => new TicketQueryDao(db),
    [ConnectionProviderToken],
),
// exports: [..., TicketQueryPortToken]
```

## 4. Test

Mock `ConnectionProvider`; assert SQL fragments, binds and paging math. See [Write tests → adapters](write-tests.md#infrastructure-adapters).

Next: [Add a use case](add-use-case.md).
