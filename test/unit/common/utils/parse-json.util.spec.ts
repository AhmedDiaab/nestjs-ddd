import { parseJson } from '@common/utils';

type TestType = { name: string };
describe('parseJson test suite', () => {
    it('should parse stringified json and map it to passed type', () => {
        // Arrange
        const input = JSON.stringify({ name: 'test' });

        // Act
        const result = parseJson<TestType>(input);

        // Assert
        expect(result).toEqual({ name: 'test' });
    });

    it('should parse json and map it to passed type', () => {
        // Arrange
        const input = { name: 'test' };

        // Act
        const result = parseJson<TestType>(input);

        // Assert
        expect(result).toEqual({ name: 'test' });
    });

    it('should parse undefined', () => {
        // Arrange
        const input = undefined;

        // Act
        const result = parseJson<TestType>(input);

        // Assert
        expect(result).toBeUndefined();
    });

    it('should throw error if input not json or object', () => {
        // Arrange
        const input = 123;

        // Act
        const parse = () => parseJson<TestType>(input);

        // Assert
        expect(parse).toThrow(new Error('Expected JSON string or object'));
    });
});
