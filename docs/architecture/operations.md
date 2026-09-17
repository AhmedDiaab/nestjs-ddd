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

What `start-service.ps1` does:

1. Checks nssm, node version, `dist\main.js`, and the env file (warns if missing).
2. Removes an existing service with the same name, then installs `node dist\main.js` with `AppDirectory` = the repo.
3. Sets **only** `NODE_ENV` on the service. dotenv-flow reads `.env.<env>` at startup, so secrets never land in the service registry.
4. Configures graceful stop (Ctrl+C, then wait `StopTimeoutMs`), restart on crash after 5 s, auto start.
5. Writes service stdout/stderr to `logs\service-stdout.log` / `service-stderr.log`, rotated at 10 MB. Application logs still go to `logs\app.log` via pino-roll.

Re-run `start-service.ps1` after changing its parameters. After changing only `.env.<env>` or `dist`, restarting the service is enough.

## Logs

See [Logging](logging.md).
