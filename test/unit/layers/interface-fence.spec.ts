import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const INTERFACE_ROOT = join(__dirname, '../../../src/interface');
const INFRASTRUCTURE_SPECIFIER = /['"]@infrastructure(?:\/[^'"]*)?['"]/;

function collectTsFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return collectTsFiles(full);
        return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
    });
}

/**
 * ESLint's `no-restricted-imports` gives the fast failure; this is what survives someone
 * editing the config away. Interface depends on application ports and `@shared`, never on
 * infrastructure adapters directly (`docs/architecture/overview.md`).
 */
describe('interface layer fence', () => {
    it('contains no import of @infrastructure anywhere under src/interface', () => {
        // Arrange
        const files = collectTsFiles(INTERFACE_ROOT);

        // Act
        const offenders = files.filter((file) =>
            INFRASTRUCTURE_SPECIFIER.test(readFileSync(file, 'utf8')),
        );

        // Assert
        expect(offenders).toEqual([]);
    });
});
