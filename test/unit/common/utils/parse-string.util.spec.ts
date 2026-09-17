import { toString } from '@common/utils';

describe('toString test suite', () => {
    it('should parse term as string and return it as String object', () => {
        // Arrange
        const input = 123;

        // Act
        const result = toString(input);

        // Assert
        expect(result).toBe('123');
    });

    it('should return null if term is null', () => {
        // Arrange
        const input = null;

        // Act
        const result = toString(input);

        // Assert
        expect(result).toBeNull();
    });
});
