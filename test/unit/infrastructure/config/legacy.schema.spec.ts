import { legacySchema } from '@infrastructure/config/schemas';

describe('legacySchema', () => {
    it('defaults to disabled with no prefixes', () => {
        // Arrange
        const input = {};

        // Act
        const parsed = legacySchema.parse(input);

        // Assert
        expect(parsed).toMatchObject({
            forwardEnabled: false,
            forwardPrefixes: [],
            preserveHostHeader: false,
        });
        expect(parsed.targetUrl).toBeUndefined();
    });

    it('rejects enabled without a target URL or prefixes, naming the missing variables', () => {
        // Arrange
        const input = { forwardEnabled: true };

        // Act
        const result = legacySchema.safeParse(input);

        // Assert
        expect(result.success).toBe(false);
        const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
        expect(messages).toEqual(
            expect.arrayContaining([
                expect.stringContaining('LEGACY_TARGET_URL'),
                expect.stringContaining('LEGACY_FORWARD_PREFIXES'),
            ]),
        );
    });

    it('accepts enabled with a target URL and at least one prefix', () => {
        // Arrange
        const input = {
            forwardEnabled: true,
            targetUrl: 'http://legacy-host:8080',
            forwardPrefixes: ['/v1/orders'],
        };

        // Act
        const result = legacySchema.safeParse(input);

        // Assert
        expect(result.success).toBe(true);
    });
});
