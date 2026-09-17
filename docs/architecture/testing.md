# Testing

## Commands

| Command                             | What                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`                         | unit tests (`test/unit/**/*.spec.ts`)                                                                                          |
| `pnpm test:watch` / `pnpm test:cov` | watch / coverage (`coverage/`)                                                                                                 |
| `pnpm test:e2e`                     | e2e tests (`test/e2e/**/*.e2e-spec.ts`); boots `AppModule` over HTTP                                                           |
| `pnpm test:oracle`                  | live Oracle tests (`test/integration/**/*.int-spec.ts`); skipped unless `ORACLE_IT_PASSWORD` is set, not part of `verify`      |
| `pnpm typecheck`                    | `tsc --noEmit` over `src` and `test`. **Jest only transpiles**, so type errors (and `@ts-expect-error` checks) are caught here |
| `pnpm verify`                       | everything a change must pass: typecheck, lint, lint:test, circular, unit, e2e, build                                          |

## Layout

```text
test/
├── unit/          # mirrors src/: unit/domain, unit/application, unit/infrastructure, unit/interface, unit/layers
├── e2e/           # HTTP tests
├── integration/   # live database tests (pnpm test:oracle)
├── fixtures/      # builders for config objects etc. (e.g. fixtures/database/oracle-source.ts)
└── fakes/         # in-memory port implementations (added per feature)
```

Path aliases (`@domain`, `@src`, …) work in tests through `jest.config.ts` / `test/jest-e2e.json` `moduleNameMapper`. Import fakes and fixtures with relative paths.

## Test structure

Every test uses **Arrange-Act-Assert** with `// Arrange`, `// Act`, `// Assert` comments and one Act per test. Rules and examples: [Write tests](../guides/write-tests.md).

## What to test where

| Layer                         | Test style                                                                                                                                                              | Doubles                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Domain                        | pure unit tests: rules, `Result` errors, events                                                                                                                         | none                              |
| Application (use cases)       | construct the use case with **in-memory fakes** of its ports                                                                                                            | fakes in `test/fakes`             |
| Infrastructure DAO/repository | mock `ConnectionProvider` so `withConnection`/`transaction` call `fn` with a mocked connection; assert SQL fragments, binds, options (`contextUser`, `tag`) and mapping | `jest.fn()`                       |
| Infrastructure clients/config | mock `oracledb` pool/connection or build config with `databaseConfigSchema.parse(...)`                                                                                  | see `test/unit/infrastructure/**` |
| Interface                     | unit-test interceptors/filters with fake `ExecutionContext`; test routes via e2e                                                                                        |                                   |
| Wiring                        | `test/unit/layers/*` checks module imports/controllers                                                                                                                  |                                   |
| HTTP end to end               | `Test.createTestingModule({ imports: [AppModule] })` + `.overrideProvider(Token).useValue(fake)` + supertest                                                            | fakes, signed JWT                 |

## Existing coverage worth knowing

- `oracle.client.spec.ts`: context user set/clear/drop lifecycle, timeouts, execute defaults, error mapping, transactions.
- `pool.manager.spec.ts`: pool creation, placeholder skipping, required-source failures, health.
- `env-config.adapter.spec.ts`: defaults for unset env, list/bool parsing, **no secrets in errors**.
- `provider.factory.spec.ts`: typed-token binding checks (`@ts-expect-error`, verified by `pnpm typecheck`).
- `app.e2e-spec.ts`: envelope, request id, health, 404, 401 without a database.
- `unit-of-work.int-spec.ts` (live): repository-style writes inside `DatabaseUnitOfWork` commit together with the actor as `CLIENT_IDENTIFIER`, and roll back together on a failed `Result` or a thrown error.
- `oracle.client.int-spec.ts` (live): `CLIENT_IDENTIFIER` visible inside the call and `NULL` on the next borrow of the **same session** (pool of 1), also after the callback throws; byte truncation; commit/rollback; `ORA-00001` → `ConflictError`.

## Live Oracle tests

Run against any Oracle the user can create tables in, e.g. the compose `oracle` service:

```bash
docker compose --env-file .env.docker up -d oracle
ORACLE_IT_PASSWORD=<app user password> pnpm test:oracle
```

| Env                        | Default                   |
| -------------------------- | ------------------------- |
| `ORACLE_IT_PASSWORD`       | unset → suite skipped     |
| `ORACLE_IT_USER`           | `app`                     |
| `ORACLE_IT_CONNECT_STRING` | `localhost:1521/FREEPDB1` |

The suite creates and drops its own `IT_ORACLE_CLIENT_<timestamp>` table. Run it after changing `OracleClient`, `oracle-pool.options.ts` or the error mapper.

## E2E environment

E2E tests set env in `beforeAll` before compiling the module:

```ts
Object.assign(process.env, {
    NODE_ENV: 'test', // dotenv files are not loaded
    JWT_SECRET: 'e2e-secret-that-is-at-least-32-chars',
    LOGGING_TO_FILE: 'false',
    LOG_LEVEL: 'error',
});
delete process.env.DATABASE_CONFIG_JSON; // no pools
```

Remember `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`: `main.ts` isn't executed in tests.

Step by step: [Write tests](../guides/write-tests.md).
