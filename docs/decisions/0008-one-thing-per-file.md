# 0008. One thing per file

- Status: Accepted
- Date: 2026-09-17

## Context

Several files had grown to hold unrelated things: `env-config.adapter.ts` declared the config error, the loader and the adapter; the CSRF guard and the unit of work declared their error classes inline; a Swagger response decorator lived in a helper file. Such files are hard to find by name, hide what a folder offers, and invite import cycles.

## Decision

A file holds **one thing**, named after it with its kind suffix (`*.error.ts`, `*.guard.ts`, `*.decorator.ts`, `*.use-case.ts`, `*.util.ts`, …):

- one class per file (errors, entities, value objects, use cases, adapters, guards, interceptors, filters, modules, test doubles), enforced by ESLint `max-classes-per-file: 1` in `src` and `test`
- one decorator, one pipe, one handler per file
- a helper that another file needs gets its own `*.util.ts`, even if it is small

Kept together because they are one unit:

- a port, its token and the types in its signature (`ticket.query.port.ts`)
- a Zod schema and its inferred type (`ticket.schema.ts` may hold the related request/response schemas of one resource)
- small pure functions of one topic in one `*.util.ts` (`envString`/`envBool`/`envList`)
- constants of one area in one `*.constants.ts`
- non-exported helpers used only by the file's main export

## Consequences

- File names tell you what's inside; barrels list one export per file.
- More small files; imports go through the folder barrel.
- Reviewers (human and agent) reject new multi-purpose files.
