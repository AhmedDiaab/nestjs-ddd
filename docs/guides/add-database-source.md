# Add a database source

A _source_ is one pool to one database/schema, identified by `key`. Use one per database (or per credential set, e.g. a read-only reporting user).

Background: [Database](../architecture/database.md), [Configuration → Database](../architecture/configuration.md#database).

## 1. Configure

```dotenv
DATABASE_CONFIG_JSON='[
  {"key":"main","dialect":"oracle","connectString":"db1:1521/APP","user":"app","passwordEnv":"MAIN_DB_PASSWORD"},
  {"key":"reporting","dialect":"oracle","connectString":"db2:1521/DWH","user":"report_ro","passwordEnv":"REPORTING_DB_PASSWORD",
   "poolMin":1,"poolMax":4,"callTimeoutMs":60000,"outFormat":"object","slowQueryMs":5000}
]'
MAIN_DB_PASSWORD=...
REPORTING_DB_PASSWORD=...

# boot fails only if these fail; others log a warning
DATABASE_PING_REQUIRED_SOURCES=main
```

- `key` must be unique.
- Prefer `passwordEnv` over `password` in JSON.
- TNS aliases: `"connectString":"DWH"` plus `"configDir":"/path/to/tns_admin"` (or `ORACLE_CLIENT_CONFIG_DIR` in thick mode).
- Wallet/TLS: `walletLocation`, `walletPasswordEnv`, `sslServerDNMatch`.

## 2. Add the key constant

```ts
// src/infrastructure/database/sources.ts
export const DatabaseSources = {
    main: 'main',
    reporting: 'reporting',
} as const;
```

## 3. Use it

```ts
return this.db.withConnection<ReportRow[], Connection>(
    DatabaseSources.reporting,
    async (connection) => (await connection.execute<ReportRow>(sql, binds)).rows ?? [],
    { contextUser: options?.actor, tag: 'reports.monthly' },
);
```

Keep source selection inside the adapter. Ports and use cases never know which database answers.

## 4. Check

- `pnpm start:dev` logs `[reporting] db.pool.created` and `db.ping.success`.
- `GET /health/ready` lists the source with `ok: true`.
- An unknown key at runtime throws `UnknownSourceKeyError` (503): check the constant matches the JSON.

## Cross-database access via DB link

If the second database is reachable through a DB link from `main`, you may not need a second pool. `DATABASE_USE_DBLINK` is available as a flag (`config.get('database.useDbLink')`) for adapters that switch table names to `table@link`. Build those names from constants only.
