# Diagrams

## Layers and dependency direction

```mermaid
flowchart LR
    subgraph Interface
        C[Controllers / Guards / Interceptors / Filter]
    end
    subgraph Application
        UC[Use cases]
        QP[Query & gateway ports + tokens]
    end
    subgraph Domain
        AG[Entities / Value objects / Aggregates]
        RP[Repository interfaces + tokens]
    end
    subgraph Infrastructure
        CFG[EnvConfigAdapter]
        LOG[PinoLoggerAdapter]
        REPO[Oracle repositories]
        DAO[Query DAOs]
        CP[ConnectionProvider / PoolManager / OracleClient]
    end

    C --> UC
    UC --> QP
    UC --> RP
    UC --> AG
    RP --> AG

    REPO -. implements .-> RP
    DAO -. implements .-> QP
    CFG -. implements .-> QP
    LOG -. implements .-> QP
    REPO --> CP
    DAO --> CP
```

Solid arrows are imports. Dotted arrows are "implements": infrastructure depends on the interfaces, never the reverse.

## HTTP request

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant MW as Express middleware<br/>(helmet, body limits, CORS, pino-http)
    participant G as Guards<br/>(Throttler, Jwt)
    participant Z as ZodHttpInterceptor
    participant RF as ResponseFormatterInterceptor
    participant Ctl as Controller
    participant UC as Use case
    participant P as Port adapter<br/>(repository / DAO)
    participant F as GlobalExceptionFilter

    Client->>MW: HTTP request
    MW->>G: req.id assigned
    G-->>F: 401 / 429 (HttpException)
    G->>Z: allowed
    Z-->>F: 400 validation failed
    Z->>RF: req.validated set
    RF->>Ctl: handler(@Validated, @CurrentUser)
    Ctl->>UC: execute(input)
    UC->>P: port call (actor = username)
    P-->>UC: data / domain object
    UC-->>Ctl: Result.ok(value) or Result.err(error)
    Ctl-->>RF: Result
    alt Result.ok / plain value
        RF-->>Client: 200 { success: true, data, meta }
    else Result.err
        RF-->>F: rethrow error
        F-->>Client: 4xx/5xx { success: false, error, meta }
    end
```

## Database call with context user

```mermaid
sequenceDiagram
    autonumber
    participant R as Repository / DAO
    participant CP as ConnectionProvider (PoolManager)
    participant OC as OracleClient
    participant Pool as oracledb Pool
    participant DB as Oracle

    R->>CP: withConnection('main', fn, { contextUser, tag })
    CP->>OC: withConnection(fn, options)
    OC->>Pool: getConnection()
    OC->>OC: connection.clientId = contextUser
    OC->>DB: execute(sql) + piggybacked CLIENT_IDENTIFIER
    DB-->>OC: rows
    OC->>OC: map ORA/NJS errors, log slow queries
    OC->>OC: connection.clientId = ''
    OC->>DB: ping() (flushes the cleared identifier)
    alt ping ok
        OC->>Pool: close({ drop: false }) → back to pool
    else ping failed
        OC->>Pool: close({ drop: true }) → connection discarded
    end
    OC-->>R: result
```

## Startup and shutdown

```mermaid
sequenceDiagram
    participant Main as main.ts
    participant Cfg as EnvConfigAdapter
    participant PM as PoolManager
    participant App as Nest app

    Main->>Cfg: load .env.<NODE_ENV>, validate (exit 1 on error, no values printed)
    Main->>PM: init sources (createPool per oracle source)
    PM->>PM: pingAll (retries, backoff, required sources)
    Main->>App: listen(port)
    Note over App: SIGTERM / SIGINT / Ctrl+C (NSSM)
    App->>PM: onModuleDestroy → pool.close(drainTimeSec)
```
