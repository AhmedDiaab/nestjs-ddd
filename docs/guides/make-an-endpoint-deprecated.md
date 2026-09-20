# Make an endpoint deprecated

`@Deprecated(...)` marks a route as going away: every response from that route carries the
standard `Deprecation` (RFC 9745), `Sunset` (RFC 8594) and, optionally, `Link` (RFC 9745 /
RFC 5829) headers, and Swagger shows the operation as `deprecated: true`.

It is opt-in, the same way `@Public()` and `@Idempotent()` are: nothing about a route changes
until it carries the decorator.

Where:

| Piece       | Location                                                     |
| ----------- | ------------------------------------------------------------ |
| Util        | `src/interface/http/common/deprecation-headers.util.ts`      |
| Decorator   | `src/interface/http/decorators/deprecated.decorator.ts`      |
| Interceptor | `src/interface/http/interceptors/deprecation.interceptor.ts` |

Background: [HTTP interface → Deprecation](../architecture/http-interface.md#deprecation).

## 1. Decorate the handler

```ts
// src/interface/http/controllers/orders.controller.ts
import { CurrentUser, Deprecated, UseZodHttp, Validated } from '@interface/http/decorators';
import { Controller, Get } from '@nestjs/common';

@Controller('orders')
export class OrdersController {
    @Get()
    @Deprecated({
        since: '2026-01-01',
        sunset: '2026-12-31',
        successor: 'https://api.example.com/v2/orders',
        link: 'https://docs.example.com/deprecations/orders-v1',
        note: 'Use v2 instead; v1 stops serving after the sunset date.',
    })
    @UseZodHttp({ query: listOrdersQuerySchema })
    list(@Validated('query') query: ListOrdersQuery, @CurrentUser() user: JWTPayload) {
        return this.listOrders.execute({ ...query, username: user.username });
    }
}
```

Nothing else about the controller changes: it still validates, calls one use case, and returns
its `Result`, exactly as [Add a controller](add-controller.md) describes.

## 2. The options

```ts
type DeprecatedOptions = {
    since: string; // required, 'YYYY-MM-DD' — becomes `Deprecation: @<unix-seconds>`
    sunset: string; // required, 'YYYY-MM-DD' — must not be earlier than `since`
    successor?: string; // absolute URL → Link rel="successor-version" (RFC 5829)
    link?: string; // absolute URL → Link rel="deprecation" (RFC 9745)
    note?: string; // free text appended to the generated Swagger description
};
```

- **`since` and `sunset` are both required.** RFC 9745's `Deprecation` field has no valueless
  (boolean) form — its value must be a date — so there is no correct header to send without one.
  `sunset` is required because a deprecation with no retirement date is a shrug, not a policy: see
  [decision 0009](../decisions/0009-deprecation-dates-live-on-the-route-not-config.md).
- Both are plain `'YYYY-MM-DD'` strings, validated with Zod (`z.iso.date()`) and read as UTC
  midnight of that day when formatting the headers.
- `sunset` must not be earlier than `since` (RFC 9745's own requirement); violating it throws,
  naming both dates in the message.
- `successor`/`link` must be absolute URLs (`z.url()`); a relative path throws.
- A bad value throws a plain `Error` **at module load** — effectively at boot, the same fail-fast
  posture as `InvalidConfigError` — not on the route's first request. See
  `parseDeprecatedOptions`/`formatDeprecationHeaders` in `deprecation-headers.util.ts`.

## 3. What the client sees

```
HTTP/1.1 200 OK
Deprecation: @1767225600
Sunset: Thu, 31 Dec 2026 00:00:00 GMT
Link: <https://api.example.com/v2/orders>; rel="successor-version", <https://docs.example.com/deprecations/orders-v1>; rel="deprecation"
```

| Header        | Present when                    | Format                                                         |
| ------------- | ------------------------------- | -------------------------------------------------------------- |
| `Deprecation` | always, on a decorated route    | RFC 9745 Structured Fields Date Item: `@<unix-seconds>`        |
| `Sunset`      | always, on a decorated route    | RFC 8594 IMF-fixdate (`Date.prototype.toUTCString()`'s format) |
| `Link`        | `successor` and/or `link` given | one header, multiple values joined with `, '` (RFC 8288 §3)    |

The headers are **advisory**. A route past its `sunset` date still answers normally — this
decorator never blocks a request, it only labels the response. Enforcing a hard cutoff (returning
410, say) is a separate decision for whoever owns the route; nothing here makes it automatic.

## 4. Where it sits in the interceptor chain

`DeprecationInterceptor` is registered in `interface.module.ts` **between `MetricsInterceptor`
and `ZodHttpInterceptor`** — as early as possible. Unlike `IdempotencyInterceptor`, which has to
be the innermost interceptor because it stores and replays the handler's raw payload, this
interceptor only calls `res.setHeader(...)` before `next.handle()` and never touches the return
value. Running it early means the headers are already on the response before anything downstream
can fail — a `400` from Zod validation or a `500` from the handler still carries the deprecation
notice.

## 5. The retirement policy

This is the actual policy, not just the mechanism:

1. **Announce with `@Deprecated(...)` at least one minor version ahead** of the release that stops
   serving the route. A client needs real lead time to notice the header (or the changelog entry)
   and plan a migration — "deprecated in the same release it disappears" is not a deprecation.
2. **Ship the successor first.** `successor` should point at a route that already works before any
   client is asked to move — never at a version still being built.
3. **Keep serving until `sunset`.** The route stays fully functional — same behaviour, same
   correctness — for its entire deprecated life. `sunset` is a promise about when support ends, not
   a target for when it's convenient to remove the code.
4. Past `sunset`, removing the route (or returning `410 Gone`) is a decision made explicitly, in
   its own change — this template does not do it automatically, because an automatic cutoff on a
   date computed from a string would be one accidental clock skew away from taking down a route
   nobody meant to remove yet.

## 6. Honest limitations

- **A request a guard rejects never reaches an interceptor.** Guards run before interceptors in
  Nest's pipeline (see [Guards](../architecture/http-interface.md#guards)), so a `401` from
  `JwtGuard`, a `403` from `RolesGuard` or `CsrfGuard`, or a `429` from `ThrottlerGuard` carries
  none of these headers — the request never reaches `DeprecationInterceptor`. There is no way to
  attach a header to a response an upstream guard already sent; a client relying on these headers
  to discover a deprecation must first get past authentication.
- **These headers are not readable from a browser today.** They are not on the CORS
  `Access-Control-Expose-Headers` safelist, and this application does not set that header at all
  (see [Security defaults](../architecture/http-interface.md#security-defaults)), so a
  cross-origin `fetch()` client cannot read `Deprecation`/`Sunset`/`Link` from JavaScript — the
  same pre-existing gap `x-request-id` has. A server-to-server caller, or `curl`, sees them fine;
  a browser app would need `Access-Control-Expose-Headers` configured, which is out of scope here.
- **No automatic enforcement.** As noted above, nothing stops serving a route once `sunset` has
  passed; see [`test/e2e/deprecation.e2e-spec.ts`](../../test/e2e/deprecation.e2e-spec.ts), whose
  already-past-sunset route still returns `200`.

## Related

- [Add a controller](add-controller.md)
- [Make an endpoint idempotent](make-an-endpoint-idempotent.md) — the closest existing analogue:
  an opt-in HTTP cross-cutting decorator + interceptor
- [HTTP interface → Deprecation](../architecture/http-interface.md#deprecation)
- [Decision 0009](../decisions/0009-deprecation-dates-live-on-the-route-not-config.md)
