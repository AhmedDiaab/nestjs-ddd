---
name: add-db-access
description: Add or change database access in this template, either an aggregate repository (domain port + Oracle implementation + mapper), a read-only query port + DAO, or a gateway over another team's procedures/functions/cursors, including SQL, stored procedures, pagination, bindings in DatabaseModule and adapter tests. Use for any task touching SQL, oracledb, DAOs, repositories or DatabaseModule.
---

# Add database access

## Choose the shape

| Need                                                                                | Build                                                                                                                                                | Guide                                              |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Load/modify/save a domain aggregate                                                 | repository interface in `src/domain/repositories` + `Oracle<Name>Repository` + mapper                                                                | `docs/guides/add-repository.md`                    |
| Lists, details, reports, procedure outputs for responses                            | query port in `src/application/ports/queries` + `<Name>QueryDao`                                                                                     | `docs/guides/add-query-port-and-dao.md`            |
| Actions through another team's procedures (their rules), cursors/functions they own | gateway port in `src/application/ports/gateways` + `<Name>Gateway` in `infrastructure/database/gateways`; query port + DAO for cursor/function reads | `docs/guides/work-with-a-database-you-dont-own.md` |
| A new database/schema                                                               | source entry + key in `src/infrastructure/database/sources.ts`                                                                                       | `docs/guides/add-database-source.md`               |

Never create ports under `src/infrastructure/**` for use cases to import.

## Adapter template

```ts
constructor(private readonly db: ConnectionProvider) {}

method(args, options?: { actor?: string }) {
    return this.db.withConnection<Result, Connection>(   // db.transaction(...) for writes
        DatabaseSources.main,
        async (connection) => {
            const { rows } = await connection.execute<Row>(SQL, { ...binds }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
            return rows?.map(Mapper.toX) ?? [];
        },
        { contextUser: options?.actor, tag: '<feature>.<method>' },
    );
}
```

Bind in `src/infrastructure/database/database.module.ts`:

```ts
ProviderFactory.factory(PortToken, (db: IConnectionProvider) => new Adapter(db), [ConnectionProviderToken]),
// and add PortToken to exports
```

## SQL checklist

- [ ] Every value is a bind (`:name`). Only constant fragments are interpolated.
- [ ] `ORDER BY` comes from a `Record<Sort, string>` whitelist and ends with a unique column.
- [ ] Bind names aren't SQL keywords (`:offset`, `:fetch`, `:size`, `:date`, `:level`) → ORA-01745.
- [ ] Named columns with `OUT_FORMAT_OBJECT`; row types use upper-case keys.
- [ ] Pagination: `OFFSET :rowOffset ROWS FETCH NEXT :rowLimit ROWS ONLY` with `size + 1` rows for `hasNext`.
- [ ] Writes use `transaction`; procedures that commit themselves are documented.
- [ ] `null` (not `undefined`) for empty binds; CLOB outputs via `lobToString`.
- [ ] `contextUser` and `tag` passed.
- [ ] Driver errors aren't swallowed. Translate specific codes (e.g. `ORA-20101`) outside the callback via `DatabaseExecutionError.code`.

## Tests

Mock `ConnectionProvider` (`withConnection`/`transaction` call `fn(connection)`); assert:

- source key, `contextUser`, `tag`
- SQL fragments, exact binds
- mapping

Structure every test as Arrange-Act-Assert (`// Arrange`, `// Act`, `// Assert`). See `docs/guides/write-tests.md#infrastructure-adapters`. Then run `pnpm verify`.
