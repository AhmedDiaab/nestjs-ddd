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

| Variable                            | Default            | Notes                                                                                     |
| ----------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `LOG_LEVEL`                         | `info`             | `debug` \| `info` \| `warn` \| `error`                                                    |
| `SHOW_STACK_TRACES`                 | `false`            | include trimmed stacks in error logs; `origin`/`causeOrigin` are always logged regardless |
| `REQUEST_ID_HEADER`                 | `x-request-id`     | incoming id reused; otherwise a UUID                                                      |
| `LOGGING_TO_FILE`                   | `true`             | daily-rotated file via pino-roll                                                          |
| `LOGGING_DIR` / `LOGGING_FILE_NAME` | `logs` / `app.log` |                                                                                           |
| `LOGGING_FILES_LIMIT`               | `14`               | rotated files kept                                                                        |
| `LOGGING_MAX_SIZE`                  | `10m`              | per file; `b`/`k`/`m`/`g`                                                                 |
| `LOGGING_PRETTY`                    | development only   | needs `pino-pretty` (devDependency); falls back to JSON                                   |

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

`main.ts` starts Nest with `rawBody: true`, so every parsed request has its exact bytes buffered onto `req.rawBody` — `IdempotencyInterceptor` needs them to fingerprint a request without being fooled by a re-serialized body. `JSON_BODY_LIMIT` / `URLENCODED_BODY_LIMIT` still cap how large that buffered body (and therefore the memory it holds per in-flight request) can be; they were not changed for this, but it is worth knowing the raw bytes are now held in memory for the lifetime of the request, not just parsed and discarded.

### TLS

Optional in-process TLS termination — off by default, since a load balancer/VIP usually terminates TLS instead ([Operations → TLS](operations.md#tls)).

| Variable          | Default   | Notes                                                                   |
| ----------------- | --------- | ----------------------------------------------------------------------- |
| `TLS_ENABLED`     | `false`   | terminate TLS in this process instead of a load balancer/VIP            |
| `TLS_KEY_FILE`    | –         | path to the PEM private key; required when `TLS_ENABLED=true`           |
| `TLS_CERT_FILE`   | –         | path to the PEM certificate (chain); required when `TLS_ENABLED=true`   |
| `TLS_CA_FILE`     | –         | path to an extra PEM trust chain; optional even when `TLS_ENABLED=true` |
| `TLS_PASSPHRASE`  | –         | decrypts an encrypted private key; treat as a secret, never logged      |
| `TLS_MIN_VERSION` | `TLSv1.2` | `TLSv1.2` \| `TLSv1.3`                                                  |

A bad or missing path fails at boot: `loadTlsOptions` (`src/infrastructure/tls/load-tls-options.ts`) reads the files once, before Nest starts, and throws `InvalidConfigError` naming the path, never the file's contents.

### Cluster

Multi-core scaling on a single box via Node's built-in `cluster` module — no external process manager, off by default ([Operations → Process model](operations.md#process-model)).

| Variable                         | Default | Notes                                                                                                                                                                                  |
| -------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLUSTER_ENABLED`                | `false` | run a primary + N worker processes instead of one                                                                                                                                      |
| `CLUSTER_WORKERS`                | `0`     | worker process count; `0` = one per CPU core (`resolveWorkerCount`)                                                                                                                    |
| `CLUSTER_RESPAWN`                | `true`  | fork a replacement when a worker exits unexpectedly                                                                                                                                    |
| `CLUSTER_RESPAWN_MAX_PER_MINUTE` | `10`    | ceiling on respawns per rolling minute, so a crash loop can't fork forever                                                                                                             |
| `CLUSTER_METRICS_PORT`           | –       | primary serves aggregated `/metrics` here when set and `METRICS_ENABLED=true`; unset = no aggregated endpoint, a worker's own `/metrics` still answers with just that worker's numbers |

With more than one worker, three boot-time rails run in the primary before any worker is forked (`runClusterBootRails`):

- `IDEMPOTENCY_STORE=memory` **fails at boot** — the same posture as any other invalid configuration ([Idempotency](#idempotency) above): per-worker claim state would make `@Idempotent()` silently wrong, not merely absent.
- `THROTTLE_STORAGE=memory` logs a warning naming the effective limit: each worker enforces its own counter, so the real ceiling across the cluster is `THROTTLE_LIMIT × workers`, not `THROTTLE_LIMIT`.
- Database pool capacity is logged for every configured source: `poolMax × workers` sessions, the same number [Migrate a legacy service](../guides/migrate-a-legacy-service.md) already warns about for several separate instances.

`SCHEDULER_ENABLED=true` only registers cron jobs on the elected leader worker (`JobScheduler`) — no extra configuration needed. See [decision 0012](../decisions/0012-cluster-primary-owns-forking.md).

### Legacy forwarding

Forwards paths not yet migrated off a legacy service to it (option B, "new service in front" —
[Migrate a legacy service](../guides/migrate-a-legacy-service.md)). Off by default; a dumb hop, not
a gateway — see [decision 0013](../decisions/0013-legacy-forwarder-is-dumb-transport.md).

| Variable                      | Default | Notes                                                                                                                                                              |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LEGACY_FORWARD_ENABLED`      | `false` | requires `LEGACY_TARGET_URL` and at least one `LEGACY_FORWARD_PREFIXES` entry when `true`                                                                          |
| `LEGACY_TARGET_URL`           | –       | base URL of the legacy service, e.g. `http://legacy-host:8080`                                                                                                     |
| `LEGACY_FORWARD_PREFIXES`     | `[]`    | comma-separated path prefixes forwarded as-is; everything else still answers through this app (`FallbackController` still returns 404 for genuinely unknown paths) |
| `LEGACY_TIMEOUT_MS`           | `10000` | per request to the legacy service; keep it below a typical VIP's request timeout (often 30-60s)                                                                    |
| `LEGACY_PRESERVE_HOST_HEADER` | `false` | forward the client's original `Host` header instead of the legacy target's                                                                                         |

Wired with `app.use()` in `src/main.ts` — the composition root, not `src/interface` (the ESLint
layer fence forbids the interface layer from importing infrastructure) — immediately after
`helmet()` and before the body parsers, so the raw request stream is still intact when it reaches
the forwarder. Consequently it also runs before `RequestContextMiddleware`, so it resolves its own
request id from `REQUEST_ID_HEADER`, generating one when the caller sent none
(`src/infrastructure/legacy/legacy-forwarder.ts`). Bodies stream through with `node:http`/
`node:https`, never buffered — `FetchHttpClient` cannot be reused here, it buffers the response via
`response.text()`. A transport failure on this hop becomes 502 (connection refused, DNS, reset
socket) or 504 (timeout); any status the legacy service actually returned, including 4xx and 5xx,
passes through unchanged — the one deliberate departure from the gateway rules in [Call another
service](../guides/call-another-service.md). Failures log `legacy.forward.failed` with the method,
path and status only, never a body or header.

### Idempotency

Backs `@Idempotent()` ([guide](../guides/make-an-endpoint-idempotent.md)).

| Variable                         | Default            | Notes                                                                                                                   |
| -------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `IDEMPOTENCY_STORE`              | `memory`           | `memory`: per instance, lost on restart. `oracle`: shared across instances, survives a restart                          |
| `IDEMPOTENCY_TABLE`              | `IDEMPOTENCY_KEYS` | Oracle only; must match `/^[A-Za-z][A-Za-z0-9_]{0,29}$/` — the one identifier SQL can't bind, so it's validated at boot |
| `IDEMPOTENCY_TTL_MS`             | `86400000` (24h)   | how long a claimed key (in progress or completed) is remembered at all                                                  |
| `IDEMPOTENCY_IN_PROGRESS_TTL_MS` | `60000`            | how long an in-progress claim is honoured before it's treated as abandoned and re-claimed                               |
| `IDEMPOTENCY_HEADER`             | `idempotency-key`  | header carrying the client-supplied key                                                                                 |

`IDEMPOTENCY_STORE=oracle` does not fail at boot if no `main` database is configured — `DatabaseModule` binds the port regardless of what's in `DATABASE_CONFIG_JSON`. The first `claim()` call then fails with `UnknownSourceKeyError` instead.

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
