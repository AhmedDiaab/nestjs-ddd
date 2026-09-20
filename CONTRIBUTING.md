# Contributing

This repository exists to be forked. Most people arrive here right after clicking "Use this
template" or `git clone`-ing their fork, so this page starts there.

## Getting set up

```bash
nvm use          # or install the Node version in .nvmrc by hand (>= 22.18.0)
corepack enable   # or install pnpm 10.15.0 some other way
pnpm install      # also installs the git hooks — see "How the rules are enforced" below
```

If this is a new project starting from the template (not a contribution back to the template
itself), rename it before writing any code:

```bash
pnpm rename-project <kebab-name> ["Title"]
```

That updates `package.json`, the `APP_NAME` used in problem URNs, the Swagger title, the Docker
Compose project name and the Windows service name in one pass — see the script's own output for
exactly what it touched.

Then copy `.env.example` to `.env.development`, set at least `NODE_ENV=development` and
`JWT_SECRET` (32+ characters), and `pnpm start:dev`.

## The gate

`pnpm verify` is the done check. Run it before saying anything is finished:

```bash
pnpm verify
```

It chains `typecheck`, `lint`, `lint:test`, `check:circular`, `test`, `test:e2e` and `build`. CI
(`.github/workflows/verify.yml`) runs the same command on every pull request, plus two things
`verify` does not: `pnpm format:check` and `pnpm test:cov`.

`test:cov` fails if coverage drops below the floor in `jest.config.ts`:

| Statements | Branches | Functions | Lines |
| ---------- | -------- | --------- | ----- |
| 87%        | 72%      | 76%       | 87%   |

That floor is a floor, not a target — raise it when coverage genuinely rises (new tests landing
faster than new code), but never lower it to make a change pass. If a change would drop coverage
below it, add the missing tests instead.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`type(scope):
subject`), enforced by [commitlint](https://commitlint.js.org/) on every commit via a `commit-msg`
hook — see `commitlint.config.mjs`. In short:

- `type` is one of `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`,
  `style`, `test`.
- `subject` doesn't start with a capital letter (no sentence-case). Embedded acronyms are fine
  (`feat(http): add an outbound HTTP client...` is a real commit in this repo's history and
  passes).
- The body, when there is one, explains **why**, not just what changed — especially for fixes.
- `scope` is not a closed list: this repo invents a scope per feature or area rather than
  maintaining an enum. Recent examples, straight out of `git log --oneline`: `cluster`, `config`,
  `e2e`, `interface`, `legacy`, `logging`, `main`, `metrics`, `scheduler`, `tls`, `auth`, `http`,
  `database`, `guides`, `deps`. Pick whatever names the area you touched; commitlint won't reject
  a new one.

Merge commits (`Merge branch '...'`) are exempt automatically — commitlint ignores them by
default, so merging a feature branch never trips the hook.

## How the rules are enforced

Most of this repository's conventions are enforced by tooling, not by review discipline alone:

- **Layer boundaries** (`interface → application → domain`, infrastructure behind ports):
  `eslint.config.mjs`'s `no-restricted-imports` rules per layer, `madge` for import cycles
  (`pnpm check:circular`), and the layer specs under `test/unit/layers/` that assert the rule
  itself hasn't been weakened.
- **One thing per file** and **named barrel exports** (no `export *`): ESLint (`max-classes-per-file`,
  a custom `no-restricted-syntax` rule for `ExportAllDeclaration`).
- **Formatting**: Prettier, checked in CI (`pnpm format:check`) and applied to staged files locally
  by `lint-staged` on every commit (see below), so a formatting diff never reaches CI in the first
  place.

The rules themselves, and why they're shaped this way, are documented in
[`AGENTS.md`](AGENTS.md) and [`docs/README.md`](docs/README.md) rather than restated here — read
those for the actual conventions (database access, error handling, testing, ports/tokens, etc.).

### Git hooks

`pnpm install` runs `prepare`, which installs [husky](https://typicode.github.io/husky/) hooks
into `.husky/`:

- **`pre-commit`** runs `lint-staged` — ESLint (`--fix`) then Prettier on staged `*.ts` files,
  Prettier alone on staged `*.md`/`*.json`/`*.yml`/`*.yaml`. It only touches what you staged, so a
  commit stays fast; the full gate (`pnpm verify`, `pnpm test:cov`) still runs in CI and is still
  the thing that has to pass before merging.
- **`commit-msg`** runs commitlint against the message you just wrote.

`git commit --no-verify` skips both hooks. It exists for emergencies (a hotfix, a hook that's
itself broken) — reach for it deliberately, not as a way around a message the hook is right to
reject.

## Release process

There is no release bot, deliberately. Cutting a version is a manual, three-step process:

1. Every pull request that changes behaviour, configuration or conventions adds its entry under
   `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md), in the same commit as the change — see the
   file's own header for the section skeleton (`Added` / `Changed` / `Deprecated` / `Removed` /
   `Fixed` / `Security`).
2. When it's time to cut a release, fold `## [Unreleased]` into a new `## [X.Y.Z]` section (date
   included), tag `vX.Y.Z`, and push the tag.
3. Create a GitHub release from that tag, with the folded changelog section as its notes.

## Decision records

Non-obvious architectural or process calls get a short record under `docs/decisions/` (template
and index: [`docs/decisions/README.md`](docs/decisions/README.md)). Read the relevant one before
changing what it covers, and add a new record rather than silently reversing one.

Decision numbers are shared with this template's lean sibling, `nestjs-ddd-lean`: a record numbered
`000N` here and `000N` there is the same decision, adapted to what each repository actually has —
see [decision 0015](docs/decisions/0015-shared-files-between-the-two-templates.md) for the full
rule and the list of files worth diffing between the two repos when either one changes.

This change (repository hygiene: license, contributing guide, PR template, commit linting and git
hooks) has no decision record of its own — this file is the record for it.
