@AGENTS.md

## Claude Code specifics

- Project settings (`.claude/settings.json`, shared):
    - allow the verification commands and read-only git
    - deny reading local `.env` files
    - format edited `.ts`/`.md`/`.json` files with Prettier after every Write/Edit
    - personal overrides go in `.claude/settings.local.json` (gitignored)
- Project skills (`.claude/skills/`):
    - `add-feature`: scaffold a feature across all layers following the guides
    - `add-db-access`: add a repository or query DAO with the SQL and context-user rules
    - `verify`: run the full check suite and fix failures
- Subagent (`.claude/agents/architecture-reviewer.md`): reviews a diff for layer violations, port placement, SQL safety, error mapping and missing tests. Use it before committing non-trivial changes.
- Reference implementation: the `example/tickets` branch has a complete feature (domain → controller → tests) that compiles against this template. Read it instead of guessing patterns.
