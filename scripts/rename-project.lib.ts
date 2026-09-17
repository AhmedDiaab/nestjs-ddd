/**
 * Renames the template's project identity in one pass. Pure functions; the CLI does the IO.
 * Plain TypeScript only (no enums/parameter properties) so Node can run it with type stripping.
 */

export const TEMPLATE_NAME = 'nestjs-ddd';
export const TEMPLATE_PASCAL = 'NestjsDdd';
export const TEMPLATE_TITLE = 'NestJS DDD';

/** Files that carry the project identity. Docs examples are included so they match. */
export const RENAME_FILES = [
    'package.json',
    'src/shared/app.constants.ts',
    'src/interface/http/swagger/swagger.constants.ts',
    'docker-compose.yml',
    'start-service.ps1',
    'stop-service.ps1',
    'docs/architecture/http-interface.md',
    'docs/architecture/operations.md',
];

export type ProjectNames = { kebab: string; pascal: string; title: string };

const KEBAB = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function toProjectNames(kebab: string, title?: string): ProjectNames {
    if (!KEBAB.test(kebab)) {
        throw new Error(`Project name must be kebab-case (e.g. "orders-api"), got "${kebab}"`);
    }
    const words = kebab.split('-');
    const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    return {
        kebab,
        pascal,
        title: title?.trim() || words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
    };
}

/** Replaces template identifiers in one file's content. Returns the content unchanged if nothing matches. */
export function renameContent(content: string, names: ProjectNames): string {
    return content
        .replaceAll(TEMPLATE_NAME, names.kebab)
        .replaceAll(TEMPLATE_PASCAL, names.pascal)
        .replaceAll(TEMPLATE_TITLE, names.title);
}
