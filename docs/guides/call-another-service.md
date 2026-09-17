# Call another service

Outbound HTTP: how a use case reaches an API that isn't yours, with a timeout, retries that only repeat what is safe to repeat, a circuit breaker per upstream, and the correlation id carried across.

Terms: [Glossary](../glossary.md). The pattern is the same as for a stored procedure someone else owns: [Work with a database you don't own](work-with-a-database-you-dont-own.md).

## The shape

```text
use case ──► GatewayPort (application/ports/gateways)
                   ▲
                   │ implements
             gateway adapter (infrastructure) ──► HttpClient ──► the other service
```

- The **use case** knows `suspendAccount(accountId)`, not that it is an HTTP POST.
- The **gateway port** lives in `application/ports/gateways` and speaks `Result` with the refusals the business cares about.
- The **gateway adapter** builds the request, reads the response and translates it. It is the only place that knows the other service's URLs, status codes and payload shape.
- `HttpClient` (`infrastructure/http`) is the transport: one call, with the reliability behaviour around it. It is an infrastructure contract, like `ConnectionProvider` — application and interface code never inject it.

## 1. The port

```ts
// src/application/ports/gateways/account-gateway.port.ts
import { createToken } from '@shared';
import type { Result } from '@shared';

export type SuspendAccountFailure = AccountNotFoundError | AccountAlreadySuspendedError;

export interface AccountGateway {
    suspend(
        accountId: string,
        options?: { actor?: string },
    ): Promise<Result<void, SuspendAccountFailure>>;
}

export const AccountGatewayToken = createToken<AccountGateway>('AccountGateway');
```

## 2. The adapter

```ts
// src/infrastructure/gateways/account-api.gateway.ts
export class AccountApiGateway implements AccountGateway {
    constructor(
        private readonly http: HttpClient,
        private readonly config: ConfigPort,
    ) {}

    async suspend(accountId: string, options?: { actor?: string }) {
        const response = await this.http.request<{ code?: string }>({
            method: 'POST',
            url: `${this.config.get('accountApi.baseUrl')}/v1/accounts/${accountId}/suspend`,
            headers: { 'x-acting-user': options?.actor ?? '' },
            body: { reason: 'requested' },
            tag: 'accounts.suspend',
            // the upstream deduplicates by account id, so repeating is safe
            idempotent: true,
        });

        if (response.status === 404) return Result.err(new AccountNotFoundError(accountId));
        if (response.status === 409) return Result.err(new AccountAlreadySuspendedError(accountId));
        if (response.status >= 400) {
            // not a refusal we know: let it become a 503 rather than inventing a meaning
            throw new InfrastructureError('Account API rejected the call', {
                status: response.status,
                code: response.body.code,
            });
        }

        return Result.ok(undefined);
    }
}
```

Wire it like any adapter, in the module that owns it:

```ts
ProviderFactory.factory(
    AccountGatewayToken,
    (http: HttpClient, config: ConfigPort) => new AccountApiGateway(http, config),
    [HttpClientToken, ConfigPortToken],
),
```

Base URLs and credentials come from config ([Add a config variable](add-config-variable.md)); never hard-code a hostname and never read `process.env` in an adapter.

## What the client does for you

| Behaviour           | Default                                                                  | Override                                                                 |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **Timeout**         | `HTTP_CLIENT_TIMEOUT_MS` (5s), per attempt                               | `timeoutMs` on the request                                               |
| **Retries**         | `HTTP_CLIENT_RETRIES` (2), exponential + jitter                          | `retries` on the request                                                 |
| **Circuit breaker** | opens after 5 consecutive failures, per origin                           | `HTTP_CLIENT_CIRCUIT_*`, or off with `HTTP_CLIENT_CIRCUIT_ENABLED=false` |
| **Correlation**     | the incoming request id, under the same header name this service accepts | send your own header to override                                         |
| **User agent**      | `HTTP_CLIENT_USER_AGENT`                                                 | per-request `headers`                                                    |

Rules it follows, and why:

- **Status codes come back, they don't throw.** Whether 404 means "not found" or "fine, nothing to do" is the gateway's call, not the transport's. Only transport failures throw: `UpstreamTimeoutError`, `UpstreamUnavailableError`, `CircuitOpenError` — all `InfrastructureError`s, so they surface as **503** without leaking the upstream's internals.
- **Retries only repeat what is safe to repeat**: `GET`, `HEAD`, `OPTIONS`, `PUT`, `DELETE`, plus anything you explicitly mark `idempotent: true`. A `POST` is sent once, because the upstream may have acted before the answer was lost. Mark it idempotent only when the other side deduplicates (an idempotency key, an upsert by your identifier) — and say so in the code, as above.
- **Only "not now" statuses are retried**: 408, 425, 429, 500, 502, 503, 504. A 400 or a 422 means the request is wrong; sending it again wastes both sides' time and delays the error the caller needs.
- **`Retry-After` wins over the backoff.** The upstream knows when it will be ready, and ignoring it is how a thundering herd forms.
- **The breaker is per origin.** One failing dependency doesn't stop calls to another, and while it is open the calls fail immediately instead of tying up workers for the timeout each time.
- **Nothing sensitive is logged**: the log line has the tag, origin, method, status, duration and attempt count — never the query string, headers or body.

## Timeouts are a budget, not a wish

Your own request has a deadline: `SERVER_TIMEOUT` and whatever the load balancer allows. A call that retries twice with a 5 second timeout can take 15 seconds plus backoff, so:

- give calls on the request path a **short** timeout (1–3s) and at most one retry;
- keep the whole chain under the caller's deadline: `timeout × (retries + 1) + backoff < your budget`;
- push long work off the request path (a scheduled job, a queue) rather than raising the timeout.

## Failure by failure

| The upstream…                            | You get                    | Becomes           | Do                                                         |
| ---------------------------------------- | -------------------------- | ----------------- | ---------------------------------------------------------- |
| answers 4xx you expected                 | a response                 | your `Result.err` | map it to a domain/application error                       |
| answers 4xx you didn't expect            | a response                 | throw             | `InfrastructureError`; 503, details in logs only           |
| answers 5xx after the retries            | a response                 | throw             | same; don't pass the upstream's status through as your own |
| doesn't answer in time                   | `UpstreamTimeoutError`     | 503               | nothing to catch, unless the work can continue without it  |
| refuses the connection                   | `UpstreamUnavailableError` | 503               | same                                                       |
| has been failing and the breaker is open | `CircuitOpenError`         | 503               | let it fail fast; this is the breaker doing its job        |

When the call is a side effect the user's request shouldn't fail on (a notification, an audit ping), catch it in the use case, log it, and return success — deliberately, with a comment saying why.

## Testing

- **Unit**: give the gateway a fake `HttpClient` and assert the mapping — each status to each `Result`, and that an unexpected status throws. No network in unit tests.
- **Reliability behaviour** is already covered for the client itself (`test/unit/infrastructure/http/`): retries, non-idempotent methods, `Retry-After`, timeouts, breaker opening and recovering.
- **E2E**: `test/e2e/http-client.e2e-spec.ts` starts a real upstream server and asserts the correlation id and user agent arrive — copy it when a gateway's wiring is worth proving.

## Checklist

- [ ] Gateway port in `application/ports/gateways`, returning `Result` with the expected refusals
- [ ] Adapter in infrastructure; base URL and credentials from config
- [ ] `tag` set on every request (it is what you will search the logs by)
- [ ] `idempotent: true` only where the upstream deduplicates, with a comment saying how
- [ ] Timeout and retries fit inside your own request deadline
- [ ] Unexpected statuses throw instead of being mapped to a business meaning
- [ ] No token, header or body in logs
- [ ] Unit tests for the status mapping, including the unexpected-status path
