import { matchesLegacyPrefix } from '@infrastructure/legacy';

describe('matchesLegacyPrefix', () => {
    it('matches a path equal to a configured prefix', () => {
        // Arrange
        const path = '/v1/orders';
        const prefixes = ['/v1/orders'];

        // Act
        const result = matchesLegacyPrefix(path, prefixes);

        // Assert
        expect(result).toBe(true);
    });

    it('matches a sub-path of a configured prefix', () => {
        // Arrange
        const path = '/v1/orders/123';
        const prefixes = ['/v1/orders'];

        // Act
        const result = matchesLegacyPrefix(path, prefixes);

        // Assert
        expect(result).toBe(true);
    });

    it('does not match a path that only shares characters with the prefix', () => {
        // Arrange
        const path = '/v1/orders-archive';
        const prefixes = ['/v1/orders'];

        // Act
        const result = matchesLegacyPrefix(path, prefixes);

        // Assert
        expect(result).toBe(false);
    });

    it('returns false for an empty prefix list', () => {
        // Arrange
        const path = '/v1/orders';
        const prefixes: string[] = [];

        // Act
        const result = matchesLegacyPrefix(path, prefixes);

        // Assert
        expect(result).toBe(false);
    });

    it('matches when the incoming path has a trailing slash', () => {
        // Arrange
        const path = '/v1/orders/';
        const prefixes = ['/v1/orders'];

        // Act
        const result = matchesLegacyPrefix(path, prefixes);

        // Assert
        expect(result).toBe(true);
    });

    it('matches when the configured prefix has a trailing slash', () => {
        // Arrange
        const path = '/v1/orders/123';
        const prefixes = ['/v1/orders/'];

        // Act
        const result = matchesLegacyPrefix(path, prefixes);

        // Assert
        expect(result).toBe(true);
    });

    it('matches against any prefix in a list of several', () => {
        // Arrange
        const path = '/v1/invoices/9';
        const prefixes = ['/v1/orders', '/v1/invoices'];

        // Act
        const result = matchesLegacyPrefix(path, prefixes);

        // Assert
        expect(result).toBe(true);
    });

    it('does not match an unrelated path', () => {
        // Arrange
        const path = '/v1/tickets';
        const prefixes = ['/v1/orders', '/v1/invoices'];

        // Act
        const result = matchesLegacyPrefix(path, prefixes);

        // Assert
        expect(result).toBe(false);
    });
});
