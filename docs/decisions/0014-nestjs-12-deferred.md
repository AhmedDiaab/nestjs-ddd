# 0014. Defer the `@nestjs/*` 12 upgrade

- Status: Accepted
- Date: 2026-09-19

## Context

Dependabot's `nestjs` group (`@nestjs/common`, `core`, `passport`, `platform-express`, `swagger`, `cli`, `schematics`, `testing` 11→12, plus the ungrouped `@nestjs/schedule` 6→12) fails `pnpm typecheck`:

```
src/infrastructure/logging/pino.module.ts(13,35): TS2345 … not assignable to 'LoggerModuleAsyncParams'
src/infrastructure/throttling/throttling.module.ts(15,38): TS2345 … not assignable to 'ThrottlerAsyncOptions'
```

The working hypothesis going in was that `nestjs-pino` and `@nestjs/throttler` still peer-depend on `@nestjs/common@^11`, so pnpm would install a second copy of `@nestjs/common` and `ModuleMetadata` from one copy would not be `ModuleMetadata` from the other. That turned out to be wrong: a scratch install of the bump resolves a **single** `@nestjs/common@12.0.3` across the whole graph (`pnpm why @nestjs/common`, the lockfile's `snapshots:` section, and the physical `node_modules/.pnpm` symlinks all agree — nestjs-pino's own `node_modules/@nestjs/common` points at the exact same directory as the project's). There is no duplicate-identity problem.

The real cause: `@nestjs/common@12` switched to pure ESM (`"type": "module"`) with a `package.json` `"exports"` map of

```json
{ ".": "./index.js", "./internal": "./internal.js", "./*.js": "./*.js", "./*": "./*.js" }
```

`interfaces` is a **directory** (`interfaces/index.js`), not a flat `interfaces.js` file, so the `"./*": "./*.js"` pattern doesn't cover it. Under this project's `moduleResolution: "nodenext"`, the deep import `@nestjs/common/interfaces` — which both `nestjs-pino@4.4.1` and every published `@nestjs/throttler` (up to `6.7.0`, the latest) still use in their `.d.ts` files — no longer resolves at all (confirmed directly: `error TS2307: Cannot find module '@nestjs/common/interfaces'`). Because that failure happens inside a dependency's `.d.ts` and `skipLibCheck: true` suppresses the error, `ModuleMetadata` silently becomes `any` there. `Pick<any, 'imports' | 'providers'>` does not preserve optionality the way `Pick` does for a real interface — verified directly with a scratch probe (`const t: Pick<any, 'imports'> = {}` fails with the identical "is missing the following properties" message) — so `LoggerModuleAsyncParams` and `ThrottlerAsyncOptions` end up requiring `imports`/`providers` that are optional in the real `ModuleMetadata`. Our call sites correctly omit them; the type error is upstream, not in our `inject` arrays.

`nestjs-pino@5.2.0` already fixed this on its side — its `params.d.ts` now imports `ModuleMetadata` from `'@nestjs/common'` (the top-level barrel) instead of the broken `/interfaces` subpath, and it declares `@nestjs/common@^11.0.8 || ^12.0.0` plus a new `@nestjs/core` peer. But `nestjs-pino` isn't in Dependabot's `nestjs` group (it isn't `@nestjs/*`-scoped) and jumping it a major on its own is a separate migration, not this item.

`@nestjs/throttler`, by contrast, has **no fixed version published**: `6.7.0`, its latest release, still imports from `@nestjs/common/interfaces` (checked directly against its shipped `.d.ts`), even though its `peerDependencies` already claims `@nestjs/common@^12.0.0`. The declared peer range is simply wrong for its actual type declarations.

A third, independent blocker: `@nest-lab/throttler-storage-redis@1.2.0` (latest published version — no newer major exists) declares `peerDependencies: { "@nestjs/common": "^7.0.0 || … || ^11.0.0" }`, with nothing published that supports `^12`.

A fourth, lower-severity one: `@nestjs/schematics@12.0.3` requires `typescript@>=6.0.0`; this project is pinned to TypeScript 5 (a deliberate stack choice per `AGENTS.md`), so that peer is unmet by design, not by oversight.

### What Nest's own migration guide says

The findings above were reached by reading the packages; the [official v11 → v12 migration guide](https://docs.nestjs.com/migration-guide) agrees with them and adds three things worth writing down.

It confirms the mechanism rather than contradicting it: all core Nest packages now ship as ESM with an `exports` map, and deep imports into subpaths are no longer resolvable — the guide's instruction is to import from the package root instead, which is exactly the fix `nestjs-pino@5.2.0` applied and `@nestjs/throttler` has not.

It also says a CommonJS application does **not** have to convert to ESM: Node's `require(esm)` keeps it working. So the runtime was never this template's blocker — the failure is purely at the type level, in a dependency's `.d.ts`, and it bites here precisely because `tsconfig.json` already sets `module`/`moduleResolution: nodenext` with `resolvePackageJsonExports: true`, which is the configuration the guide prescribes. A project still on `moduleResolution: node` would not see the error at all; being correctly configured is what exposes it.

Two further requirements apply when the upgrade does happen:

- **Node**: running v12 needs v20.19+, v22.12+ or v24+ (this template's 22.18.0 qualifies), but the **CLI** — which `pnpm build` uses through `nest build` — needs v22.22.3+, v24.15+ or v26+. `.nvmrc` and `engines.node` must move with the upgrade.
- **Behaviour**: `@Optional()` is no longer inherited by subclasses (this template uses it once, on a constructor parameter in `metrics.controller.ts`, not through inheritance — unaffected), and lifecycle hooks now run ordered by component hierarchy level, which is worth re-checking against `job-scheduler.ts` and `pool.manager.ts`. Terminus, NATS and GraphQL breaking changes do not apply here.

## Decision

Do not force the `@nestjs/*` 11→12 bump. `@nestjs/throttler` has no version whose type declarations resolve against `@nestjs/common@12`'s new `exports` map, and `@nest-lab/throttler-storage-redis` has no version that declares a `^12` peer at all — both are upstream gaps this repository cannot close by itself. Patching around them (stub `imports: []`/`providers: []` to satisfy the broken types, or vendoring a type-only shim for `@nestjs/common/interfaces`) would be lying to the type checker about a real upstream defect, not fixing our code — the `inject` arrays this template deliberately types ([0002](0002-typed-di-tokens.md)) were never the problem.

`.github/dependabot.yml`'s `nestjs` group gets an `ignore` entry so the PR stops reopening every week until upstream catches up.

### There is a forced path, and it is deliberately not taken

The upgrade _can_ be made to compile today: a `tsconfig` `paths` entry mapping `@nestjs/common/interfaces` to the real `node_modules/@nestjs/common/interfaces/index.d.ts` (the directory still ships), a pnpm peer override for `@nest-lab/throttler-storage-redis`, Node raised to 22.22.3+ for the CLI, and TypeScript 6. That is two workarounds, a Node floor bump and a compiler major, in exchange for nothing a user of this template can see — the application stays CommonJS, so v12's ESM change is invisible at runtime, and 11.1.6 is current and patched.

The template argument decides it: every fork inherits those two workarounds and the obligation to remove them later. Shipping a starting point that opens with a shim for an upstream bug the reader has never heard of is worse here than the same shim would be in one application.

The concrete risk if it were taken anyway is not the shims but v12's lifecycle-hook reordering, which lands on `job-scheduler.ts` and `pool.manager.ts` — the two places where this codebase's ordering is load-bearing and was verified against a real `SIGTERM` ([Operations](../architecture/operations.md#graceful-shutdown)).

### TypeScript ceiling

Independently of Nest: `typescript-eslint@8.70.0` peers `typescript >=4.8.4 <6.1.0` and `ts-jest@29.4.12` peers `>=4.3 <7`, and no published version of either supports TypeScript 7 — the native Go port breaks every tool that embeds the compiler API. **6.0.3 is the highest version this repository can take**, and it is what `@nestjs/schematics@12` asks for, so TypeScript 7 would cost `lint`, `lint:test`, `test` and `test:e2e` while buying nothing. The repo stays on 5.9.x until the Nest upgrade makes 6.x worth doing in the same branch; the `tsconfig` files are already written in TS 6 terms (explicit `types`, no `baseUrl`, `nodenext` resolution, `esModuleInterop` on), so that part is a no-op when the day comes.

## Consequences

- `@nestjs/common`, `core`, `passport`, `platform-express`, `swagger`, `cli`, `schematics`, `testing` and `@nestjs/schedule` stay on their 11.x / 6.x lines.
- `pnpm typecheck` stays green; `throttling.module.ts` and `pino.module.ts` are unchanged.
- **Revisit when**: `@nestjs/throttler` ships a version whose `.d.ts` imports `ModuleMetadata` from `'@nestjs/common'` instead of `'@nestjs/common/interfaces'` (or otherwise resolves under `moduleResolution: nodenext` against `@nestjs/common@12`), **and** `@nest-lab/throttler-storage-redis` (or its replacement) declares a `@nestjs/common@^12` peer. The upgrade then also carries a Node bump (`.nvmrc` and `engines.node` to at least 22.22.3, for the CLI) and a re-check of lifecycle-hook ordering. Bumping `nestjs-pino` to `5.x` can happen independently and earlier, since it already fixed its side — but it is a separate change with its own migration (a new `@nestjs/core` peer, and whatever behavioural changes ride along with its major), tracked separately from this deferral.
- Until then, `docs/known-gaps.md` carries this as the template's one open dependency gap.
