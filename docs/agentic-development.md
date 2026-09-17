# Agentic development

How this repository is set up for AI coding agents, and how to get reliable results from them.

## What's in the repo

| File                                      | Read by                                                                      | Purpose                                                                             |
| ----------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `AGENTS.md`                               | Codex, Cursor, Copilot agent mode, Gemini CLI, Claude Code (via `CLAUDE.md`) | commands, layer rules, conventions, boundaries, definition of done, links to guides |
| `CLAUDE.md`                               | Claude Code                                                                  | imports `AGENTS.md` (`@AGENTS.md`) and lists Claude-specific tooling                |
| `.claude/settings.json`                   | Claude Code (shared)                                                         | permissions and hooks, see below                                                    |
| `.claude/settings.local.json`             | Claude Code (personal, gitignored)                                           | your own overrides                                                                  |
| `.claude/skills/add-feature/`             | Claude Code skill                                                            | scaffold a feature across all layers                                                |
| `.claude/skills/add-db-access/`           | Claude Code skill                                                            | repositories, DAOs, SQL rules, adapter tests                                        |
| `.claude/skills/verify/`                  | Claude Code skill                                                            | run `pnpm verify` and fix failures without weakening rules                          |
| `.claude/agents/architecture-reviewer.md` | Claude Code subagent                                                         | read-only review of a diff against the architecture rules                           |
| `docs/guides/*`                           | all agents                                                                   | step-by-step recipes with compiled example code                                     |
| `docs/decisions/*`                        | all agents                                                                   | why rules exist; agents must add a record to reverse one                            |
| `example/tickets` branch                  | all agents                                                                   | complete reference feature                                                          |

Other tools can reuse the same material: Cursor rules or Copilot instructions can link to `AGENTS.md` instead of duplicating it.

## Guardrails that make agent output checkable

Rules agents can't silently break:

| Guardrail                     | Enforced by                                                   |
| ----------------------------- | ------------------------------------------------------------- |
| Layer boundaries              | ESLint `no-restricted-imports` (`pnpm lint`)                  |
| No import cycles              | `pnpm check:circular`                                         |
| Correct port bindings         | typed tokens + `ProviderFactory` overloads (`pnpm typecheck`) |
| Strict types in src and tests | `strict: true`, `pnpm typecheck`                              |
| Behaviour                     | unit + e2e tests                                              |
| Formatting                    | Prettier hook after each Claude Code edit                     |
| One command for "done"        | `pnpm verify`                                                 |

Claude Code project permissions (`.claude/settings.json`):

- **Allowed without prompting:** `pnpm verify|typecheck|lint|lint:test|lint:fix|check:circular|test*|build|format`, `pnpm exec jest|prettier`, and `git status|diff|log|show`.
- **Denied:** reading `.env`, `.env.local`, `.env.development`, `.env.test`, `.env.staging`, `.env.production` and `.env.*.local`. `.env.example` stays readable.
- **Hook:** after Write/Edit, `pnpm exec prettier --write` runs on the edited `.ts`/`.md`/`.json` file.

Everything else (installing packages, commits, pushes, deleting files, other shell commands) still asks.

## Workflow that works

1. **Plan first for anything multi-file.** Ask the agent to list the files it will create or change, mapped to layers. Compare against `docs/guides/feature-walkthrough.md`.
2. **Point at the reference.** "Follow `docs/guides/add-repository.md`; use `git show example/tickets:src/infrastructure/database/repositories/oracle-ticket.repository.ts` as the pattern."
3. **Build inside-out** (domain → ports → use cases → adapters → HTTP → tests), with `pnpm typecheck` after each layer.
4. **Verify.** "Run the verify skill" (or `pnpm verify`) until green.
5. **Review.** "Use the architecture-reviewer agent on the diff." Fix blocking findings.
6. **Commit** with Conventional Commits, one logical change per commit.

### Example prompts

```text
Add a "Comments" feature: users can add a comment (1–2000 chars) to an open ticket and list comments
for a ticket (paged, newest first). Adding to a closed ticket must return 409. Table: TICKET_COMMENTS
(id, ticket_id, body, created_by, created_at). Use the add-feature skill. Show me the file plan first.
```

```text
The site delete procedure raises ORA-20101 when the user lacks region rights. Map it to a 403 in the
DAO, add a test, and run verify. Follow docs/guides/add-error.md.
```

```text
Review my current diff with the architecture-reviewer agent and fix anything blocking.
```

## What agents can't verify here

- **Real database behaviour.** SQL is checked by tests against mocked connections only. Run against Oracle (see [Write tests → Real database](guides/write-tests.md#real-database)) before merging SQL-heavy changes.
- **Windows service scripts.** They need Windows + NSSM.
- **Deployment configuration and secrets.** Agents can't read `.env` files by design.

Ask the agent to state explicitly what it didn't verify.

## Keeping the setup healthy

- When a convention changes, update `AGENTS.md`, the affected guide, and (if it reverses a decision) add a record in `docs/decisions/`, in the same PR.
- Keep `AGENTS.md` short and link out; agents load it on every task.
- When a guide's example changes, update the `example/tickets` branch and re-run `pnpm verify` there.
- New repetitive workflows become skills (`.claude/skills/<name>/SKILL.md` with a precise `description` saying when to use it).
