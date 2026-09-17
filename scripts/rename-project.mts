/**
 * Usage: pnpm rename-project <kebab-name> ["Display Title"]
 * Example: pnpm rename-project orders "Order Desk"
 * The title replaces "NestJS DDD" (Swagger shows "<title> API"), so leave "API" out of it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RENAME_FILES, renameContent, toProjectNames } from './rename-project.lib.ts';

const [, , kebab, title] = process.argv;
if (!kebab) {
    console.error('Usage: pnpm rename-project <kebab-name> ["Display Title"]');
    process.exit(1);
}

const names = toProjectNames(kebab, title);
const root = join(import.meta.dirname, '..');

for (const file of RENAME_FILES) {
    const path = join(root, file);
    const before = readFileSync(path, 'utf8');
    const after = renameContent(before, names);
    if (after !== before) {
        writeFileSync(path, after);
        console.log(`updated ${file}`);
    }
}

console.log(`Project renamed to "${names.kebab}" (${names.title}). Run pnpm verify.`);
