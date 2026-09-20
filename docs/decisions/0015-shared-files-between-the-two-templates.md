# 0015. Shared files between the two templates

- Status: Accepted
- Date: 2026-09-20

## Context

`nestjs-ddd` and `nestjs-ddd-lean` are siblings, not one codebase with a branch. This repository is
upstream — the full template, with metrics, W3C tracing, an outbound HTTP client, a cron scheduler,
rate limiting, idempotency, a unit of work, domain events, Docker and CI. `nestjs-ddd-lean` is a
deliberately trimmed copy, kept as its own repository so it can stay simpler on purpose rather than
hiding the extra subsystems behind flags here.

Nothing propagates between them. [Known gaps](../known-gaps.md) already names this as an open
problem ("a fix made here does not reach `nestjs-ddd-lean` unless someone applies it twice") and
suggests exactly this record as the remedy. The first sync — porting the toolchain bump, error
origin logging and optional in-process TLS into lean — is what prompted writing it, and it paid for
itself immediately: reading lean's copy of the ported `main.ts` is what exposed the env-file
ordering bug that had already shipped here.

## Decision

**No automation.** No shared package, no codegen, no CI check for drift. Keeping the two in sync is
a manual diff discipline: when either repo changes a file on the list below, check whether the
change belongs in the other, and adapt rather than copy — lean omits whole subsystems, so a change
touching one of those does not apply there at all.

Files worth diffing when either repo changes them:

- **Conventions and tooling config**: `.prettierrc`, `CLAUDE.md`, the conventions sections of
  `AGENTS.md`. Known, intentional divergences (this repo's interface-fence lint rule, its `@mocks`
  jest mapper, its higher coverage floor, the location of the `jitter-delay`/`semaphore`/
  `with-backoff` utilities) are left alone rather than reconciled.
- **Error origin logging**: `src/common/utils/error-origin.util.ts` and its spec,
  `format-stack-trace.util.ts`, `src/application/errors/app.error.ts`,
  `src/domain/errors/domain.error.ts`, the `LogMeta` shape in `src/application/shared/logging.ts`,
  the error serializer inside `src/infrastructure/logging/pino.options.ts` (the file's shape differs
  between repos; the serializer should not), and `--enable-source-maps` wherever each repo starts
  `node` in production.
- **The HTTP error filter and its helpers**: `src/interface/http/global-exception.filter.ts` and
  `src/common/utils/parse-string.util.ts` — both were fixed together when a stricter lint rule
  found real bugs in each.
- **The config pipeline**: `src/infrastructure/config/load-config.ts`, `env-config.adapter.ts`, the
  schemas both repos carry (`tls.schema.ts` should stay comparable), and the shared blocks of
  `.env.example`.
- **TLS**: `src/infrastructure/tls/`, `docs/architecture/operations.md` § TLS and the TLS rows in
  `docs/architecture/configuration.md`.
- **`package.json` devDependency versions** for the tools both use the same way: `eslint`,
  `@eslint/js`, `prettier`, `typescript-eslint`, `eslint-plugin-prettier`, `jest`, `@types/*`.
  Runtime dependencies are not shared — lean's set is intentionally smaller.

**Decision numbers mean the same decision in both repos.** A record numbered `000N` here and `000N`
in lean is the same decision, its content adapted to what each repo actually has. A gap in lean's
sequence means that decision does not apply there — currently 0009 (deprecation headers), 0012
(cluster), 0013 (the legacy forwarder) and 0014 (the Nest 12 deferral, which depends on packages
lean does not carry). A number is never reused for an unrelated decision in either repo.

## Consequences

- Porting is a review, not a copy. Every entry above means "diff and adapt": a file may legitimately
  differ in shape while still needing the same underlying fix, which is what happened to
  `pino.options.ts` in the first sync.
- The list is a starting point. A change touching a shared concern that is not listed is still worth
  checking, and belongs on the list once confirmed.
- Reserving numbers across repos costs nothing and makes a gap meaningful, but only holds while both
  sides follow it; reusing a number in either repo breaks the convention for both.
- Rejected: **one repository with a feature flag or package boundary.** That makes "lean" a
  configuration of the full template rather than a simpler starting point, and reintroduces the
  subsystems it exists to omit as dead code or conditional imports instead of absent files.
- Rejected: **a script that diffs the two repos.** The value is in adapting a change to what each
  repo has, which a mechanical diff cannot do; it would flag every intentional divergence as drift,
  or need so much repo-specific knowledge that maintaining it becomes its own sync problem.
