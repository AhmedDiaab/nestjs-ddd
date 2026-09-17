---
name: verify
description: Run this repository's full verification suite (typecheck, lint, lint:test, circular imports, unit tests, e2e tests, build) and fix any failures. Use before saying a change is done, before committing, or when asked to check/validate the project.
---

# Verify

1. Run `pnpm verify`. It stops at the first failing step.
2. On failure, fix the cause, then re-run from that step before running the full suite again:

| Step           | Re-run                  | Typical causes                                                                                                                                                                                                    |
| -------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck      | `pnpm typecheck`        | wrong port binding (typed tokens), missing export in a barrel `index.ts`, strict-mode nulls                                                                                                                       |
| lint           | `pnpm lint`             | layer boundary violation (`no-restricted-imports`): move the port or import from `@application/ports` / `@domain`; `require-await`; unsafe `any`; `export *` in a barrel (`no-restricted-syntax`): list the names |
| lint:test      | `pnpm lint:test`        | same, in tests; fakes should return `Promise.resolve` instead of `async` without `await`                                                                                                                          |
| check:circular | `pnpm check:circular`   | barrel importing a module that imports the barrel back: import the concrete file instead                                                                                                                          |
| test           | `pnpm exec jest <file>` | behaviour change: update the test only if the new behaviour is intended                                                                                                                                           |
| test:e2e       | `pnpm test:e2e`         | controller not registered / registered after `FallbackController`, env not set before `compile()`, missing versioning in the test                                                                                 |
| build          | `pnpm build`            | usually covered by typecheck; check `tsconfig.build.json` excludes                                                                                                                                                |

3. Never "fix" by:
    - disabling lint rules or adding `eslint-disable`
    - loosening `tsconfig` strictness
    - deleting or skipping tests
    - weakening layer rules

    If a rule seems wrong, stop and explain.

4. Report which steps passed, what you changed, and anything not verified (e.g. real Oracle connectivity isn't covered by the suite).
