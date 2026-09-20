# Decisions

Short records of choices that shape the codebase. Read the relevant one before changing what it covers; add a new record instead of silently reversing one.

| #                                                              | Decision                                                                              | Status   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| [0001](0001-ports-live-with-their-callers.md)                  | Ports live with their callers; layers enforced by lint                                | Accepted |
| [0002](0002-typed-di-tokens.md)                                | Typed Symbol tokens for DI                                                            | Accepted |
| [0003](0003-oracle-context-user.md)                            | Oracle context user via `clientId`, cleared per call                                  | Accepted |
| [0004](0004-result-errors-to-http-status.md)                   | Expected failures are `Result` values mapped to HTTP status by problem kind           | Accepted |
| [0005](0005-json-database-sources.md)                          | Database sources configured as JSON; dialect placeholders kept                        | Accepted |
| [0006](0006-singleton-providers.md)                            | Singleton providers; no request-scoped DI                                             | Accepted |
| [0007](0007-named-barrel-exports.md)                           | Barrels list named exports; no `export *`                                             | Accepted |
| [0008](0008-one-thing-per-file.md)                             | One thing per file (one class, decorator or helper; ESLint `max-classes-per-file`)    | Accepted |
| [0009](0009-deprecation-dates-live-on-the-route-not-config.md) | `@Deprecated()` dates live on the route, not config; both required, validated at boot | Accepted |
| [0010](0010-error-origin.md)                                   | Log the error's origin frame, not a stack trace; always on                            | Accepted |
| [0011](0011-tls-optional-in-process.md)                        | Optional in-process TLS, off by default                                               | Accepted |
| [0012](0012-cluster-primary-owns-forking.md)                   | Cluster primary owns forking; never builds a Nest application                         | Accepted |
| [0013](0013-legacy-forwarder-is-dumb-transport.md)             | Legacy forwarder streams configured prefixes; status passes through untouched         | Accepted |
| [0014](0014-nestjs-12-deferred.md)                             | Defer the `@nestjs/*` 12 upgrade (upstream type breakage, not our code)               | Accepted |
| [0015](0015-shared-files-between-the-two-templates.md)         | Files shared with `nestjs-ddd-lean`, diffed by hand; numbers mean the same decision   | Accepted |

Template for a new record (`NNNN-short-title.md`):

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences
```
