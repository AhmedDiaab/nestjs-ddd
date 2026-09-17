# 0007. Barrels list named exports; no `export *`

- Status: Accepted
- Date: 2026-09-17

## Context

Layer barrels (`src/domain/index.ts`, `src/application/ports/index.ts`, …) are what other layers import. With `export * from './x'`:

- everything a folder contains becomes public, including helpers meant to stay internal
- two modules exporting the same name are silently dropped from the barrel (TypeScript reports it only at the import site, if at all)
- reading the barrel doesn't tell you what the layer exposes, so reviews and agents have to open every file

## Decision

- Every `index.ts` lists its exports by name: `export { Ticket, type TicketStatus } from './ticket.entity'`.
- Types are marked with `type` in the list.
- `export *` (including `export * as ns`) is rejected by ESLint (`no-restricted-syntax`, `ExportAllDeclaration`).

## Consequences

- Adding a public symbol means adding it to the barrel on purpose; forgetting shows up as a type error at the import.
- Barrels double as the list of what each layer offers.
- Slightly more editing when a folder grows.
