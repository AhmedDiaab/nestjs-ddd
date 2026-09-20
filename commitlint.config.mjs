/**
 * Conventional Commits, as `AGENTS.md` and `CONTRIBUTING.md` already require.
 *
 * No `subject-case` override on purpose. The obvious one, `[2, 'always', 'lower-case']`, compares
 * the whole subject against its lower-cased self, so it rejects every subject carrying an acronym
 * or identifier — `feat(http): add an outbound HTTP client`, `feat(auth): verify the JWT on every
 * route` — which is most of this repository's history. The inherited default already forbids the
 * cases that actually matter (sentence-case, start-case, pascal-case, upper-case), so a subject
 * still cannot start with a capital; it was verified against every commit in this repository.
 */
export default {
    extends: ['@commitlint/config-conventional'],
};
