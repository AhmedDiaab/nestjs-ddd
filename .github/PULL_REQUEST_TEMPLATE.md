## What changed and why

<!-- What does this PR do, and why does it need to happen? Link an issue if there is one. -->

## Checklist

Definition of done, from [`AGENTS.md`](../AGENTS.md):

- [ ] `pnpm verify` passes, with no new lint suppressions
- [ ] Tests were added or updated for new behaviour, including failure paths and HTTP statuses
- [ ] Docs and `.env.example` were updated if config, endpoints or conventions changed
- [ ] `CHANGELOG.md` has an entry under `## [Unreleased]`

## Ask first

If this PR touches any of the following, confirm it was discussed before merging
([`AGENTS.md`](../AGENTS.md) § Boundaries):

- [ ] Public HTTP response shapes
- [ ] Database schema or migrations
- [ ] Auth / JWT verification
- [ ] CORS, helmet or throttling defaults
- [ ] The Windows service scripts
