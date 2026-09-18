# Make an endpoint idempotent

`@Idempotent()` marks a handler as safe to replay: a request carrying a known `Idempotency-Key` header runs at most once, and a retry with the same key and the same body gets the first response back instead of running the handler again.

It is opt-in, the same way `@Public()` and `@Roles()` are: an endpoint where a repeat is a legitimate second effect (an append-only audit log, say) should not start deduplicating just because a client happens to send the header.

Where:

| Piece             | Location                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Decorator         | `src/interface/http/decorators/idempotent.decorator.ts`                                                       |
| Interceptor       | `src/interface/http/interceptors/idempotency.interceptor.ts`                                                  |
| Store port        | `src/application/ports/idempotency-store.port.ts`                                                             |
| In-memory adapter | `src/infrastructure/database/idempotency/in-memory-idempotency.store.ts`                                      |
| Oracle adapter    | `src/infrastructure/database/idempotency/oracle-idempotency.store.ts`                                         |
| Config            | `src/infrastructure/config/schemas/idempotency.schema.ts`                                                     |
| Errors            | `src/interface/http/errors/{missing-idempotency-key,idempotency-key-reused,idempotency-in-progress}.error.ts` |

Background: [HTTP interface → interceptors](../architecture/http-interface.md).

## 1. Decorate the handler

```ts
// src/interface/http/controllers/orders.controller.ts
import { CurrentUser, Idempotent, UseZodHttp, Validated } from '@interface/http/decorators';
import { Controller, Post } from '@nestjs/common';

@Controller('orders')
export class OrdersController {
    constructor(private readonly placeOrder: PlaceOrderUseCase) {}

    @Post()
    @Idempotent()
    @UseZodHttp({ body: placeOrderBodySchema })
    place(@Validated('body') body: PlaceOrderBody, @CurrentUser() user: JWTPayload) {
        return this.placeOrder.execute({ ...body, username: user.username });
    }
}
```

Nothing else changes: the controller still validates, calls one use case, and returns its `Result`, exactly as [Add a controller](add-controller.md) describes.

## 2. The client contract

A caller of a `@Idempotent()` route must send an `Idempotency-Key` header (the name is configurable, see below) on every request, including retries:

- **Required.** A decorated route called without it returns **400 `MISSING_IDEMPOTENCY_KEY`**. There is no fallback to "run once with no dedupe" — the decorator's whole point is that the key is how the server tells a retry from a new request.
- **Shape.** Same as request/trace ids: `^[A-Za-z0-9._:-]{1,128}$` (`isSafeCorrelationId` from `@shared`). A key that doesn't match is treated as missing.
- **Scope.** One key per logical operation the client intends to happen once — typically a UUID generated client-side when the user action starts, and resent unchanged on every retry of that same action. Using the same key for two different operations is a caller bug the server can partially catch (see the 422 row below), not something it can silently fix.
- **The body must match on a retry.** The server fingerprints the exact request bytes (method + path + raw body, SHA-256). Resending the same key with a different body is rejected — it does not run the second body and it does not replay the first.

## 3. Behaviour

| Request                                              | Result                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| New key                                              | Row claimed `in_progress`, handler runs, response stored, its own status returned |
| Same key, same body, completed                       | Stored status and body replayed, handler never runs                               |
| Same key, **different** body                         | **422** `IDEMPOTENCY_KEY_REUSED` (`validation` kind)                              |
| Same key, first request still running                | **409** `IDEMPOTENCY_IN_PROGRESS` (`conflict` kind)                               |
| Decorated route, no header (or a malformed one)      | **400** `MISSING_IDEMPOTENCY_KEY` (`bad_request` kind)                            |
| Handler fails (throws, or returns a failed `Result`) | Key released, so the client's retry re-executes the handler                       |
| Claim older than `IDEMPOTENCY_IN_PROGRESS_TTL_MS`    | Treated as abandoned (the instance that claimed it likely crashed) and re-claimed |

The kinds already map to those statuses in `error-presenter.ts` — no change was needed there to add these three errors. `test/e2e/idempotency.e2e-spec.ts` exercises every row above end to end, against a probe controller in `test/fixtures/http/idempotency-probe.controller.ts` that counts real executions.

**A note on the replayed status.** `ClaimOutcome.replay` carries the stored HTTP status, but the interceptor is the _innermost_ one (see below), and Nest recomputes the route's static status (from `@HttpCode()` or the method's default) after every interceptor has run. In practice the stored status only wins for a route whose status genuinely varies per call — this template's controllers always return a `Result` with one fixed status per route, so the two never disagree here. A route that sometimes returns 200 and sometimes 201 from the same handler would need to set the response status itself rather than rely on `@HttpCode()`.

## 4. Where it sits in the interceptor chain

`IdempotencyInterceptor` is registered **after** `ResponseFormatterInterceptor`, making it the innermost interceptor in the chain. That is deliberate: it stores and replays the handler's raw payload, not the `{ success, data, meta }` envelope, so a replayed response is re-wrapped with the _replaying_ request's own `requestId` and `timestamp` rather than resurrecting the original's stale ones. See [HTTP interface](../architecture/http-interface.md#idempotency).

## 5. Configuration

| Variable                         | Default            | Notes                                                                    |
| -------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| `IDEMPOTENCY_STORE`              | `memory`           | `memory` (per instance) \| `oracle` (shared, survives a restart)         |
| `IDEMPOTENCY_TABLE`              | `IDEMPOTENCY_KEYS` | Oracle only; must match `/^[A-Za-z][A-Za-z0-9_]{0,29}$/` (see below)     |
| `IDEMPOTENCY_TTL_MS`             | `86400000` (24h)   | how long a claimed key — in progress or completed — is remembered at all |
| `IDEMPOTENCY_IN_PROGRESS_TTL_MS` | `60000` (1min)     | how long a claim is honoured before it's treated as abandoned            |
| `IDEMPOTENCY_HEADER`             | `idempotency-key`  | the header name clients must send                                        |

**Choosing `IDEMPOTENCY_TTL_MS`.** This is how long the server keeps the completed response available for a replay. Set it to cover the longest realistic gap between a client's original attempt and its last retry — a mobile client that retries across a network outage needs longer than a server-to-server call that retries within seconds. Too short and a late retry executes the handler again instead of getting the stored response; too long only costs storage (a row, or a map entry).

**Choosing `IDEMPOTENCY_IN_PROGRESS_TTL_MS`.** This is the window during which a second request with the same key gets `409` instead of being treated as abandoned. Set it comfortably above the slowest this handler is expected to take — if a handler can legitimately run for 10s under load, an in-progress TTL of 60s leaves margin; a tight TTL (say, 5s) turns a slow-but-healthy request into a false "abandoned" verdict, and the retry runs the handler a second time concurrently with the first. Too long, and a genuinely crashed request (the process died mid-handler) blocks retries for that whole window instead of a shorter one.

**`IDEMPOTENCY_STORE=oracle` does not fail at boot if no database is configured.** `DatabaseModule` binds `IdempotencyStorePortToken` unconditionally — it does not check whether a `main` source exists in `DATABASE_CONFIG_JSON` before deciding which adapter to construct. If you set `IDEMPOTENCY_STORE=oracle` without a `main` database, the application starts normally and the failure only appears on the first real `claim()` call, as an `UnknownSourceKeyError`. If you use the Oracle store, make sure `main` is actually configured; nothing else will tell you.

Full variable reference: [Configuration](../architecture/configuration.md).

## 6. The Oracle table

```sql
CREATE TABLE IDEMPOTENCY_KEYS (
    key           VARCHAR2(128) PRIMARY KEY,
    fingerprint   VARCHAR2(64),
    state         VARCHAR2(16),
    status        NUMBER,
    response_body CLOB,
    created_at    TIMESTAMP,
    expires_at    TIMESTAMP
);

CREATE INDEX IDEMPOTENCY_KEYS_EXPIRES_AT_IX ON IDEMPOTENCY_KEYS (expires_at);
```

- `key` is the client's `Idempotency-Key`, so it doubles as the unique-constraint lock: `OracleIdempotencyStore.claim()` does a single `INSERT` and treats the primary-key violation (ORA-00001) as "the key already exists," then reads the row to decide replay/mismatch/in-progress. No `SELECT ... FOR UPDATE`, no advisory lock — the primary key is the lock.
- `fingerprint` is the SHA-256 hex digest (64 chars) described above.
- `state` is `'in_progress'` or `'completed'`.
- `response_body` is the handler's JSON payload, stored so a replay doesn't need to re-run it.
- `expires_at` drives an opportunistic purge on every claim (`DELETE ... WHERE expires_at < SYSTIMESTAMP AND ROWNUM <= 100`), so no cron job is required to keep the table from growing forever. The index on `expires_at` is what keeps that `DELETE` from scanning the whole table as it grows.

**Why `IDEMPOTENCY_TABLE` is validated, not bound.** Every other value the adapter sends to Oracle is a bind parameter (`:p_key`, `:p_fingerprint`, …). A table name can't be — Oracle doesn't accept an identifier as a bind value — so it is the one place this adapter interpolates a config value into SQL text. `OracleIdempotencyStore`'s constructor checks it against `/^[A-Za-z][A-Za-z0-9_]{0,29}$/` (Oracle's own unquoted-identifier rule) and throws `InvalidConfigError` at boot if it doesn't match, rather than build a query out of an unchecked string.

If your database is owned by another team and already has a differently-shaped table, adjust the DDL and adapter together — see [Work with a database you don't own](work-with-a-database-you-dont-own.md) for the general approach to a schema you don't control.

## 7. The in-memory adapter

`InMemoryIdempotencyStore` keeps everything in a `Map` in process memory. It is **single-instance only**: state does not survive a restart and is not shared across replicas.

This makes it a poor fit for the exact scenario idempotency keys exist for. The problem this feature solves is a client retrying a `POST` through a load balancer that might route the retry to a _different_ instance than the one that handled the original request — and an in-memory store on instance B has never heard of the key instance A claimed. Behind more than one instance, use `IDEMPOTENCY_STORE=oracle`. The in-memory adapter is only honest for a genuinely single-instance service, and is the default because it needs no database.

## 8. The honest limitation

`IdempotencyInterceptor` claims the key, runs the handler, then completes or releases the key — three separate calls to the store, wrapping but not sharing a transaction with whatever the handler itself commits to the database. Concretely, for the Oracle adapter: the `claim()` INSERT commits in its own transaction, the handler's business write commits in its own transaction (inside the use case, as usual), and `complete()`'s UPDATE commits in a third transaction.

A crash **between** the business write committing and `complete()` committing leaves the business effect applied but the key still marked `in_progress`. Once `IDEMPOTENCY_IN_PROGRESS_TTL_MS` elapses, that claim is treated as abandoned, and a retry with the same key re-executes the handler — reapplying the effect a second time.

So what this interceptor actually gives you is **at-most-once responses under normal operation**, and **best-effort at-most-once effects**: it prevents the overwhelming majority of double-executions (the client-retries-through-a-load-balancer case this feature exists for), but it is not a transactional guarantee, and it does not claim to be one. If "at most once" must hold even across a mid-request crash, the interceptor is the wrong tool for that one endpoint.

### The stronger recipe: write the key row inside the use case's own transaction

The guarantee an outbox buys in [Deliver events reliably](deliver-events-reliably.md) comes from one thing: the event row and the aggregate's row share a single commit. The same trick closes the gap here — skip `@Idempotent()`/`IdempotencyStorePort` for this one endpoint, and instead treat the idempotency key as a row your own aggregate's `UnitOfWorkPort.run(...)` writes atomically with the business rows:

```ts
// application use case — writes its own idempotency-key row, not through @Idempotent()
export class PlaceOrderUseCase extends UseCase<Input, Output, Failure> {
    constructor(
        @Inject(OrderKeysRepositoryToken) private readonly keys: OrderKeysRepository,
        @Inject(OrdersRepositoryToken) private readonly orders: OrdersRepository,
        @Inject(UnitOfWorkPortToken) private readonly unitOfWork: UnitOfWorkPort,
    ) {
        super();
    }

    async execute(input: Input): Promise<Result<Output, Failure>> {
        const actor = input.username;

        return this.unitOfWork.run(
            async () => {
                const existing = await this.keys.findByKey(input.idempotencyKey, { actor });
                if (existing) {
                    if (existing.fingerprint !== input.fingerprint) {
                        return this.err(new IdempotencyKeyReusedError());
                    }
                    return this.ok(existing.result as Output); // same transaction, no handler re-run
                }

                const order = Order.place(input.username, input.lines);
                await this.orders.save(order, { actor }); // same transaction
                await this.keys.insert(
                    {
                        key: input.idempotencyKey,
                        fingerprint: input.fingerprint,
                        result: { orderId: order.id },
                    },
                    { actor },
                ); // commits with the order row, or not at all

                return this.ok({ orderId: order.id });
            },
            { actor },
        );
    }
}
```

`OrderKeysRepository` is an ordinary repository ([Add a repository](add-repository.md)) over a table with a unique key column, exactly like `IDEMPOTENCY_KEYS` above — the unique index is still what makes a concurrent duplicate insert fail instead of racing. The difference from the shipped adapter is entirely in _when_ the row commits: here it is one `INSERT`/`SELECT` inside the same `UnitOfWorkPort.run(...)` as `orders.save(...)`, so either both rows land or neither does. There is no window where the order exists without its key, or the key exists without the order.

The cost is that this endpoint no longer uses `@Idempotent()` at all — the controller passes the header value into the use case as an ordinary input field, and the use case computes (or receives) the fingerprint itself. That is more code than a decorator, which is why it is a recipe for the endpoints that need it rather than the default for every `POST`.

## Related

- [Add a controller](add-controller.md)
- [Deliver events reliably](deliver-events-reliably.md) — the same "write it in the same transaction" trick, applied to the outbox
- [Add a repository](add-repository.md#multiple-aggregates-in-one-transaction) — `UnitOfWorkPort.run(...)`
- [HTTP interface → interceptors](../architecture/http-interface.md)
- [Configuration](../architecture/configuration.md)
- [Observability](../architecture/observability.md) — `idempotency_requests_total{outcome}`
- `docs/known-gaps.md` section 0 — what shipped, and the residual effect-atomicity caveat
