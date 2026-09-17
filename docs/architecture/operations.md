# Operations

## Build and run

```bash
pnpm install
pnpm build                          # → dist/
NODE_ENV=production node dist/main  # or: pnpm start:prod with NODE_ENV set in the environment
```

- Requires Node.js ≥ 22.18.
- The working directory must contain the `.env.<NODE_ENV>` file; environment variables override file values.
- Non-TypeScript runtime files (templates, SQL files) must be listed in `nest-cli.json` → `compilerOptions.assets` or they won't be copied to `dist`.

| Script             | Purpose                                       |
| ------------------ | --------------------------------------------- |
| `pnpm start:dev`   | watch mode, `NODE_ENV=development`            |
| `pnpm start:debug` | watch + inspector                             |
| `pnpm start:repl`  | Nest REPL with history (`.nest_repl_history`) |
| `pnpm start:prod`  | `node dist/main` (no forced `NODE_ENV`)       |

## Docker

Files: `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.env.docker.example`.

### Image

Multi-stage build on `node:22.18.0-bookworm-slim` (glibc, so Oracle thick mode stays possible):

| Stage       | Does                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `build`     | `pnpm install --frozen-lockfile` (pnpm via corepack, version from `packageManager`), `pnpm build` |
| `prod-deps` | production dependencies only (`--prod --ignore-scripts`)                                          |
| `runtime`   | `node_modules` + `dist` + `package.json`, runs as user `node`, `CMD ["node", "dist/main.js"]`     |

Runtime defaults:

- `NODE_ENV=production`, `PORT=3000`, `LOGGING_TO_FILE=false` (logs to stdout as JSON).
- No `.env` files are copied: all configuration comes from environment variables.
- `HEALTHCHECK` calls `GET /health` (liveness).
- Exec-form `CMD`, so `SIGTERM` reaches Node and the shutdown hooks drain DB pools. Give the orchestrator a stop grace period above `drainTimeSec`.

```bash
docker build -t nestjs-ddd .
docker run --rm -p 3000:3000 -e JWT_SECRET=<32+ chars> nestjs-ddd        # no database
```

File logging in a container: set `LOGGING_TO_FILE=true` and mount a volume at `/app/logs`.

### Local stack (API + Oracle)

```bash
cp .env.docker.example .env.docker      # set JWT_SECRET, ORACLE_PASSWORD, ORACLE_APP_PASSWORD
docker compose --env-file .env.docker up --build
```

| Service  | Image                                        | Notes                                                                                                                                                   |
| -------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`    | built from `Dockerfile` (`nestjs-ddd:local`) | port `API_PORT` (3000); `DATABASE_CONFIG_JSON` points at `oracle:1521/FREEPDB1`; starts after the DB is healthy; `init: true`; `stop_grace_period: 20s` |
| `oracle` | `gvenzl/oracle-free:23-slim-faststart`       | port `ORACLE_PORT` (1521); creates `ORACLE_APP_USER` in `FREEPDB1` on first start; data in volume `oracle-data`                                         |

- Compose refuses to start without `JWT_SECRET`, `ORACLE_PASSWORD` and `ORACLE_APP_PASSWORD`.
- `.env.docker` is gitignored; only `.env.docker.example` is committed.
- The app schema is empty: create your tables as the app user (e.g. `sql app/<password>@localhost:1521/FREEPDB1`), or mount SQL into the Oracle container's `/container-entrypoint-initdb.d`.
- Check it's running:
    - `GET http://localhost:3000/health/ready` should list `main` with `ok: true`.
    - `GET /v1/database-info` with a JWT shows the `CLIENT_IDENTIFIER` the database saw.
- Reset the database: `docker compose --env-file .env.docker down -v` (deletes the volume).

This stack is for local development and integration testing, not a production deployment.

## Health endpoints

For uptime monitors, load balancers and orchestrators. No auth, not rate limited, version neutral, successful polls not logged.

| Endpoint            | 200 when                                                                     | Failure                                                             |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /health`       | the process accepts HTTP                                                     | no response                                                         |
| `GET /health/ready` | every implemented DB source answers a ping within `DATABASE_PING_TIMEOUT_MS` | **503** with per-source `details` (error text hidden in production) |

Monitoring tools should check the **status code**. Pick the endpoint by what "down" means for you:

- "API process down": `/health`
- "API down or its database unreachable": `/health/ready`

Response (`/health/ready`):

```json
{
    "success": true,
    "data": {
        "status": "ok",
        "sources": [
            {
                "sourceKey": "main",
                "dialect": "oracle",
                "implemented": true,
                "ok": true,
                "latencyMs": 4,
                "pool": { "connectionsOpen": 2, "connectionsInUse": 0, "poolMin": 2, "poolMax": 10 }
            }
        ]
    },
    "meta": { "timestamp": "...", "path": "/health/ready", "requestId": "..." }
}
```

## Startup failures

| Symptom                                                 | Cause                                                     |
| ------------------------------------------------------- | --------------------------------------------------------- |
| `❌ Invalid configuration:` + paths, exit 1             | env missing/invalid (values not printed)                  |
| `AggregateDbHealthError` at boot                        | a required DB source failed its pings                     |
| `DatabaseConnectionError ... Failed to acquire` at boot | pool creation failed (credentials, network, service name) |

## Graceful shutdown

On `SIGTERM`/`SIGINT` (Ctrl+C), Nest shutdown hooks close every DB pool with `drainTimeSec`. Give the process manager a stop timeout above that value.

## Windows service (NSSM)

`start-service.ps1` / `stop-service.ps1` at the repository root. Run as Administrator.

Prerequisites: [NSSM](https://nssm.cc) on PATH, Node.js ≥ 22.18, `pnpm install && pnpm build`, `.env.<environment>` in the app directory.

```powershell
.\start-service.ps1                                    # NestjsDddApiService, NODE_ENV=production
.\start-service.ps1 -ServiceName MyApi -Environment staging -NodePath "E:\node\node.exe" -StopTimeoutMs 20000
.\stop-service.ps1 -ServiceName MyApi                  # stop, keep registered
.\stop-service.ps1 -ServiceName MyApi -Remove          # stop and unregister
```

Checked without Windows by `pnpm test:service-scripts` (Docker): both scripts parse, and they run in the PowerShell container against recorders for `nssm`, `node` and `Get-Service` (fresh install, reinstall, Node too old, missing build, failing NSSM call, stop, stop + remove, already stopped, missing service). Registering a real service is still verified on Windows.

What `start-service.ps1` does:

1. Checks nssm, node version, `dist\main.js`, and the env file (warns if missing).
2. Removes an existing service with the same name, then installs `node dist\main.js` with `AppDirectory` = the repo.
3. Sets **only** `NODE_ENV` on the service. dotenv-flow reads `.env.<env>` at startup, so secrets never land in the service registry.
4. Configures graceful stop (Ctrl+C, then wait `StopTimeoutMs`), restart on crash after 5 s, auto start.
5. Writes service stdout/stderr to `logs\service-stdout.log` / `service-stderr.log`, rotated at 10 MB. Application logs still go to `logs\app.log` via pino-roll.

Re-run `start-service.ps1` after changing its parameters. After changing only `.env.<env>` or `dist`, restarting the service is enough.

## Logs

See [Logging](logging.md).
