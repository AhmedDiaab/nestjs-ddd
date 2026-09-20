export default {
    extends: ['@commitlint/config-conventional'],
    rules: {
        // config-conventional forbids sentence-case, start-case, pascal-case AND upper-case
        // subjects. This repo's subjects legitimately contain embedded acronyms (HTTP, JWT,
        // TLS, CSRF) and decorators (@Roles), so a strict "the whole subject must be
        // lower-case" check (commitlint's `lower-case` target does `subject.toLowerCase() ===
        // subject`) rejects real, correctly-styled commits. What this repo actually enforces is
        // narrower: the subject must not start with a capital letter (no sentence-case). Verified
        // against `git log --oneline -100` before landing this — see CONTRIBUTING.md.
        'subject-case': [2, 'never', ['sentence-case']],
        // scopes are invented per feature (see `git log --oneline`), so no enum to enforce
    },
};
