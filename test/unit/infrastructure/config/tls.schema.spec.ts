import { tlsSchema } from '@infrastructure/config/schemas';

describe('tlsSchema', () => {
    it('defaults to disabled with TLSv1.2 as the minimum version', () => {
        // Arrange
        const input = {};

        // Act
        const parsed = tlsSchema.parse(input);

        // Assert
        expect(parsed).toMatchObject({ enabled: false, minVersion: 'TLSv1.2' });
        expect(parsed.keyFile).toBeUndefined();
        expect(parsed.certFile).toBeUndefined();
    });

    it('rejects enabled without a key or cert file, naming the missing variables', () => {
        // Arrange
        const input = { enabled: true };

        // Act
        const result = tlsSchema.safeParse(input);

        // Assert
        expect(result.success).toBe(false);
        const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
        expect(messages).toEqual(
            expect.arrayContaining([
                expect.stringContaining('TLS_KEY_FILE'),
                expect.stringContaining('TLS_CERT_FILE'),
            ]),
        );
    });

    it('accepts enabled with both a key and cert file', () => {
        // Arrange
        const input = { enabled: true, keyFile: '/certs/key.pem', certFile: '/certs/cert.pem' };

        // Act
        const result = tlsSchema.safeParse(input);

        // Assert
        expect(result.success).toBe(true);
    });
});
