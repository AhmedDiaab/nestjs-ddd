# Shiftroster API Diagrams

This document captures high-level flows and structural relationships in the Shiftroster API using Mermaid diagrams.

## Request Handling Sequence

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant N as NestJS HTTP Adapter
    participant ZH as ZodHttpInterceptor
    participant RF as ResponseFormatterInterceptor
    participant CT as Controller
    participant UC as Application Use Case / Service
    participant INF as Infrastructure Adapter (e.g., Logger, Config)
    participant GF as GlobalExceptionFilter

    C->>N: HTTP Request
    N->>ZH: Forward request
    alt Route has Zod schema
        ZH->>ZH: Validate body/query/params/headers
        ZH-->>N: Throw 400 on validation error
    end
    ZH->>RF: Pass validated request
    RF->>CT: Invoke controller handler
    CT->>UC: Execute use case (returns Result/data)
    UC->>INF: Collaborate via ports (e.g., log, config, persistence)
    UC-->>CT: Result<Success|Error>
    CT-->>RF: Return Result/data
    RF-->>N: Wrap as response envelope
    N-->>C: HTTP Response (success envelope)

    Note over RF,GF: On thrown error, GF normalizes payload and RF bypasses formatting when response is already handled.
```

## Layered Architecture

```mermaid
flowchart TD
    subgraph Interface Layer
        IC["Controllers | Interceptors | Exception Filters"]
    end

    subgraph Application Layer
        AP["Use Cases | Ports | Application Errors"]
    end

    subgraph Domain Layer
        DM[Domain Models\nDomain Errors]
    end

    subgraph Infrastructure Layer
        CF["Config Adapter | (ConfigPortToken)"]
        LG["Logging Adapter | (LoggerPortToken)"]
        OT["Future Adapters | (DB, External APIs)"]
    end

    subgraph Shared Utilities
        SH["Result | Problem | Pagination | Helpers"]
    end

    IC --> AP
    AP --> DM

    IC -.-> SH
    AP -.-> SH
    DM -.-> SH

    CF --> AP
    LG --> AP
    OT --> AP

    classDef layer fill:#1f2937,stroke:#0f172a,stroke-width:1px,color:#fff;
    classDef shared fill:#0d9488,stroke:#0f766e,stroke-width:1px,color:#fff;

    class IC,AP,DM,CF,LG,OT layer;
    class SH shared;
```

The architecture diagram emphasizes dependency direction: Interface depends on Application, which depends on Domain. Infrastructure adapters implement the ports defined in the application layer, while shared utilities remain framework-agnostic and can be reused across layers.
