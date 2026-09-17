# Decisions

Short records of choices that shape the codebase. Read the relevant one before changing what it covers; add a new record instead of silently reversing one.

| #                                             | Decision                                                                    | Status   |
| --------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| [0001](0001-ports-live-with-their-callers.md) | Ports live with their callers; layers enforced by lint                      | Accepted |
| [0002](0002-typed-di-tokens.md)               | Typed Symbol tokens for DI                                                  | Accepted |
| [0003](0003-oracle-context-user.md)           | Oracle context user via `clientId`, cleared per call                        | Accepted |
| [0004](0004-result-errors-to-http-status.md)  | Expected failures are `Result` values mapped to HTTP status by problem kind | Accepted |
| [0005](0005-json-database-sources.md)         | Database sources configured as JSON; dialect placeholders kept              | Accepted |
| [0006](0006-singleton-providers.md)           | Singleton providers; no request-scoped DI                                   | Accepted |
| [0007](0007-named-barrel-exports.md)          | Barrels list named exports; no `export *`                                   | Accepted |

Template for a new record (`NNNN-short-title.md`):

```markdown
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences
```
