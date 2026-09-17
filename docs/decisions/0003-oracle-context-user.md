# 0003. Oracle context user via clientId, cleared per call

- Status: Accepted
- Date: 2026-09-17

## Context

Database auditing and VPD policies need the end user, but the pool connects with one technical account. atoll-delete-tool ran `DBMS_SESSION.SET_IDENTIFIER` (an extra round trip) and never cleared it, so later pool borrowers ran under the previous user's identifier.

## Decision

- `OracleClient.withConnection` sets `connection.clientId = contextUser`; node-oracledb sends it with the next round trip.
- In `finally` it sets `clientId = ''` and calls `ping()` to flush the clear before releasing the connection. The thin driver's ping message carries end-to-end attributes.
- If the flush fails, the connection is released with `drop: true`.
- Per source: `contextUser.enabled`, `contextUser.required`, `contextUser.maxLength` (bytes).
- Domain and application ports expose this as `actor`; adapters map it to `contextUser`.

## Consequences

- Identity can't leak between requests through the pool.
- One extra round trip (the ping) per call that sets a user.
- Every repository/DAO must pass `contextUser: options?.actor`; reviewers and the architecture reviewer agent check it.
- Other session attributes (module, action, clientInfo) could be added with the same set/clear pattern.
