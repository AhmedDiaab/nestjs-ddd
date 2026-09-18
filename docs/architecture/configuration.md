# Configuration

## Pipeline

```
.env files (dotenv-flow) ─► process.env ─► hydrate() ─► Zod schemas ─► AppConfig ─► ConfigPort.get('a.b')
```

1. **Load.** `EnvConfigAdapter` calls dotenv-flow, which reads `.env`, `.env.local`, `.env.<NODE_ENV>`, `.env.<NODE_ENV>.local` from the working directory. Real environment variables win. When `NODE_ENV=test`, no files are loaded.
2. **Hydrate.** `src/infrastructure/config/load-config.ts` maps flat env names into sections (`app`, `logging`, `http`, `database`, `jwt`) with helpers from `env.util.ts`:
    - `envString`: blank → `undefined`, so the schema default applies
    - `envBool`: `true/false/1/0/yes/no/on/off`; anything else passes through and fails validation
    - `envList`: comma-separated → trimmed array
3. **Validate.** Schemas in `src/infrastructure/config/schemas/` apply defaults and coercion.
4. **Fail fast.** `loadConfig()` (`config/load-config.ts`) throws `InvalidConfigError` (`config/invalid-config.error.ts`) listing `path: message` only (values are never printed; they may be secrets). `main.ts` prints it and exits with code 1.
5. **Read.** Inject `ConfigPortToken` and call `config.get('http.port')`, `isProduction()`, etc. Keys and value types come from the schemas: `get('http.port')` is a `number`, a misspelt key doesn't compile, and values under an optional section (`database.*`) include `undefined`. The link is type-only: `ConfigPort` declares an empty `ConfigValues` interface and `infrastructure/config/config-values.ts` merges `AppConfig` into it, so application code never imports infrastructure.

Adding a variable: [Add a config variable](../guides/add-config-variable.md).

## `.env` syntax notes

- Quote JSON values with single quotes: unquoted values are cut at the first `#`.
- Put comments on their own lines. dotenv accepts `PORT=3000 # comment`, but Docker/Compose env files read `KEY=  # comment` as the value `# comment`.
- `.env.example` documents every variable and is committed; all other `.env*` files are gitignored.

## Variables

### Application

| Variable   | Default      | Notes                                                |
| ---------- | ------------ | ---------------------------------------------------- |
| `NODE_ENV` | **required** | `development` \| `test` \| `staging` \| `production` |

### Logging

| Variable                            | Default            | Notes                                                   |
| ----------------------------------- | ------------------ | ------------------------------------------------------- |
| `LOG_LEVEL`                         | `info`             | `debug` \| `info` \| `warn` \| `error`                  |
| `SHOW_STACK_TRACES`                 | `false`            | include trimmed stacks in error logs                    |
| `REQUEST_ID_HEADER`                 | `x-request-id`     | incoming id reused; otherwise a UUID                    |
| `LOGGING_TO_FILE`                   | `true`             | daily-rotated file via pino-roll                        |
| `LOGGING_DIR` / `LOGGING_FILE_NAME` | `logs` / `app.log` |                                                         |
| `LOGGING_FILES_LIMIT`               | `14`               | rotated files kept                                      |
| `LOGGING_MAX_SIZE`                  | `10m`              | per file; `b`/`k`/`m`/`g`                               |
| `LOGGING_PRETTY`                    | development only   | needs `pino-pretty` (devDependency); falls back to JSON |

### HTTP

| Variable                                                    | Default                         | Notes                                                                                                                           |
| ----------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                      | `3000`                          |                                                                                                                                 |
| `CORS_ORIGINS`                                              | empty = CORS disabled           | comma-separated allow-list                                                                                                      |
| `SERVER_TIMEOUT` / `HEADERS_TIMEOUT` / `KEEP_ALIVE_TIMEOUT` | `120000` / `121000` / `61000`   | ms                                                                                                                              |
| `JSON_BODY_LIMIT` / `URLENCODED_BODY_LIMIT`                 | `1mb`                           | 413 when exceeded                                                                                                               |
| `SWAGGER_ENABLED`                                           | off in production, on otherwise | `/docs`                                                                                                                         |
| `THROTTLE_TTL_MS` / `THROTTLE_LIMIT`                        | `60000` / `100`                 | `THROTTLE_LIMIT=0` disables                                                                                                     |
| `THROTTLE_STORAGE`                                          | `memory`                        | `memory`: counters per instance; `redis`: shared by every instance behind a load balancer                                       |
| `THROTTLE_REDIS_URL`                                        | –                               | required when `THROTTLE_STORAGE=redis` (`redis://[:password@]host:6379[/db]`); treat as a secret                                |
| `TRUST_PROXY`                                               | `false`                         | set behind a load balancer so throttling sees client IPs                                                                        |
| `CSRF_ENABLED`                                              | `true`                          | reject cross-site POST/PUT/PATCH/DELETE authenticated by the JWT cookie ([HTTP interface](http-interface.md#security-defaults)) |
| `CSRF_TRUSTED_ORIGINS`                                      | `CORS_ORIGINS`                  | origins allowed to send cookie-authenticated writes, besides the API's own                                                      |
| `SCHEDULER_ENABLED`                                         | `false`                         | run the cron jobs in this instance ([Operations → Scheduled jobs](operations.md#scheduled-jobs))                                |
| `SCHEDULER_TIMEZONE`                                        | `UTC`                           | IANA timezone the cron expressions are read in                                                                                  |

### Metrics

| Variable                  | Default | Notes                                                                                        |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------- |
| `METRICS_ENABLED`         | `false` | serves `GET /metrics` in the Prometheus text format; unauthenticated, keep the port internal |
| `METRICS_DEFAULT_METRICS` | `true`  | Node and process metrics (heap, event loop lag, GC) alongside the application's own          |

### Shutdown

| Variable                  | Default | Notes                                                                                                         |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `SHUTDOWN_DRAIN_DELAY_MS` | `5000`  | readiness fails for this long before the server closes; set it above the load balancer's interval × threshold |
| `SHUTDOWN_FORCE_AFTER_MS` | `10000` | in-flight requests get this long, then their connections are cut                                              |
| `SHUTDOWN_JOB_DRAIN_MS`   | `10000` | an in-flight cron job gets this long to finish before the database pools close                                |

The process manager's stop grace period must exceed all three, plus the pool `drainTimeSec` ([Operations → Graceful shutdown](operations.md#graceful-shutdown)).

### Outbound HTTP

Defaults for every call a gateway makes ([Call another service](../guides/call-another-service.md)). A single request may override the timeout and the retry count.

| Variable                                | Default    | Notes                                                                                      |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `HTTP_CLIENT_TIMEOUT_MS`                | `5000`     | per attempt, so retries multiply it; keep it inside your own request deadline              |
| `HTTP_CLIENT_RETRIES`                   | `2`        | extra attempts, only for methods that are safe to repeat or marked `idempotent`            |
| `HTTP_CLIENT_RETRY_BASE_MS`             | `200`      | exponential: 200, 400, 800…                                                                |
| `HTTP_CLIENT_RETRY_JITTER_MS`           | `150`      | keeps instances from retrying in lockstep                                                  |
| `HTTP_CLIENT_RETRY_MAX_DELAY_MS`        | `5000`     | caps the backoff, and a `Retry-After` the upstream asks for                                |
| `HTTP_CLIENT_CIRCUIT_ENABLED`           | `true`     | per upstream origin                                                                        |
| `HTTP_CLIENT_CIRCUIT_FAILURE_THRESHOLD` | `5`        | consecutive failures (transport errors and 5xx) that open it                               |
| `HTTP_CLIENT_CIRCUIT_RESET_MS`          | `30000`    | how long it stays open before one trial call is allowed                                    |
| `HTTP_CLIENT_USER_AGENT`                | `APP_NAME` | the project name, renamed by `pnpm rename-project`; upstreams use it to tell callers apart |

### JWT

| Variable                      | Default      | Notes                                    |
| ----------------------------- | ------------ | ---------------------------------------- |
| `JWT_SECRET`                  | **required** | ≥ 32 characters                          |
| `JWT_ALGORITHMS`              | `HS256`      | comma-separated                          |
| `JWT_ISSUER` / `JWT_AUDIENCE` | not checked  | set to enforce                           |
| `JWT_COOKIE_NAME`             | `jwt`        | `Authorization: Bearer` is also accepted |

### Database

| Variable                                             | Default                 | Notes                                             |
| ---------------------------------------------------- | ----------------------- | ------------------------------------------------- |
| `DATABASE_CONFIG_JSON`                               | unset = no database     | JSON array of sources, or `{ "sources": [...] }`  |
| `DATABASE_PING_ON_BOOT`                              | `true`                  |                                                   |
| `DATABASE_PING_TIMEOUT_MS`                           | `3000`                  | per ping; also readiness timeout                  |
| `DATABASE_PING_MAX_RETRIES`                          | `2`                     | exponential backoff                               |
| `DATABASE_PING_REQUIRED_SOURCES`                     | all implemented sources | comma-separated keys; failure aborts boot         |
| `DATABASE_PING_CONCURRENCY`                          | `3`                     |                                                   |
| `DATABASE_PING_JITTER_MS`                            | `250`                   | random startup delay                              |
| `DATABASE_USE_DBLINK`                                | `false`                 | flag for DAOs: `config.get('database.useDbLink')` |
| `ORACLE_THICK_MODE`                                  | `false`                 | thin mode needs no Instant Client                 |
| `ORACLE_CLIENT_LIB_DIR` / `ORACLE_CLIENT_CONFIG_DIR` | none                    | thick mode                                        |
| `ORACLE_FETCH_AS_STRING`                             | none                    | `CLOB,NCLOB,NUMBER,DATE,JSON`                     |
| `ORACLE_FETCH_AS_BUFFER`                             | none                    | `BLOB`                                            |

**Common source fields** (every dialect): `key` (unique), `dialect`, `defaultSchema`, `extra` (free-form, non-Oracle).

**Oracle source fields:**

| Group     | Field                                                                      | Default              | Maps to (node-oracledb)                                              |
| --------- | -------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------- |
| Target    | `connectionUrl`                                                            | none                 | `oracle://user:pass@host:1521/service` → user/password/connectString |
|           | `connectString`                                                            | none                 | `connectString` (Easy Connect or TNS alias)                          |
|           | `user`, `password`                                                         | none                 |                                                                      |
|           | `passwordEnv`                                                              | none                 | name of an env var holding the password                              |
|           | `externalAuth`                                                             | `false`              | OS/wallet authentication                                             |
|           | `edition`, `configDir`                                                     | none                 |                                                                      |
| TLS       | `walletLocation`, `walletPassword`/`walletPasswordEnv`, `sslServerDNMatch` | none                 |                                                                      |
|           | `httpsProxy`, `httpsProxyPort`                                             | none                 |                                                                      |
| Pool      | `poolMin`                                                                  | `2`                  |                                                                      |
|           | `poolMax`                                                                  | `10`                 | must be ≥ `poolMin`                                                  |
|           | `poolIncrement`                                                            | `1`                  |                                                                      |
|           | `poolTimeoutSec`                                                           | `60`                 | `poolTimeout`                                                        |
|           | `poolMaxLifetimeSessionSec`                                                | `0`                  | `maxLifetimeSession`                                                 |
|           | `poolPingIntervalSec`                                                      | `60`                 | `poolPingInterval`                                                   |
|           | `poolPingTimeoutMs`                                                        | `5000`               | `poolPingTimeout`; also the context-clear ping timeout               |
|           | `queueMax`                                                                 | `500`                | `-1` unlimited                                                       |
|           | `queueTimeoutMs`                                                           | `60000`              | `queueTimeout`                                                       |
|           | `stmtCacheSize`                                                            | `30`                 |                                                                      |
|           | `enableStatistics`                                                         | `false`              |                                                                      |
|           | `homogeneous`                                                              | `true`               |                                                                      |
|           | `drainTimeSec`                                                             | `10`                 | `pool.close(drainTime)` on shutdown                                  |
| Network   | `connectTimeoutSec`                                                        | `20`                 | `connectTimeout` and `transportConnectTimeout`                       |
|           | `expireTimeMin`                                                            | `0`                  | dead-connection keepalive                                            |
|           | `retryCount`, `retryDelaySec`                                              | `0`, `1`             | connect retries                                                      |
|           | `callTimeoutMs`                                                            | `0` (none)           | per round trip                                                       |
| Fetch     | `fetchArraySize`                                                           | `100`                |                                                                      |
|           | `prefetchRows`                                                             | `2`                  |                                                                      |
|           | `maxRows`                                                                  | `0` (unlimited)      |                                                                      |
|           | `outFormat`                                                                | `array`              | `object` → `OUT_FORMAT_OBJECT`                                       |
| Behaviour | `slowQueryMs`                                                              | `1000`               | `0` disables                                                         |
|           | `logSql`                                                                   | `false`              | bind values are never logged                                         |
|           | `healthQuery`                                                              | `SELECT 1 FROM DUAL` | default uses `connection.ping()`                                     |
|           | `contextUser.enabled`                                                      | `true`               |                                                                      |
|           | `contextUser.required`                                                     | `false`              |                                                                      |
|           | `contextUser.maxLength`                                                    | `64`                 | bytes                                                                |

Validation rules: `connectionUrl`, or `connectString` + `user` + `password`/`passwordEnv`, or `connectString` + `externalAuth`; `poolMin <= poolMax`; unique `key`s.

**Placeholder dialects** (`postgres`, `mysql`, `mariadb`, `mssql`): `connectionUrl` or `host` + `port` + `database` + `user` + `password`; `sqlite`: `file` or `connectionUrl`.

Example:

```dotenv
DATABASE_CONFIG_JSON='[
  {"key":"main","dialect":"oracle","connectString":"db:1521/APP","user":"app","passwordEnv":"MAIN_DB_PASSWORD",
   "poolMin":4,"poolMax":20,"queueTimeoutMs":10000,"callTimeoutMs":30000,"expireTimeMin":5,
   "contextUser":{"required":true}},
  {"key":"reports","dialect":"postgres","connectionUrl":"postgres://u:p@pg:5432/reports"}
]'
MAIN_DB_PASSWORD=change-me
DATABASE_PING_REQUIRED_SOURCES=main
```
