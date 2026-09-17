import { envBool, envList, envString } from '@infrastructure/config/env.util';

describe('env helpers', () => {
    it.each([
        ['  ', undefined],
        [' a ', 'a'],
    ])('envString(%j) returns %j (blank is unset)', (input, expected) => {
        // Arrange: input from table

        // Act
        const result = envString(input);

        // Assert
        expect(result).toBe(expected);
    });

    it.each([
        [undefined, undefined],
        ['', undefined],
        ['TRUE', true],
        ['0', false],
    ])('envBool(%j) returns %j', (input, expected) => {
        // Arrange: input from table

        // Act
        const result = envBool(input);

        // Assert
        expect(result).toBe(expected);
    });

    it('envBool passes invalid input through so validation fails loudly', () => {
        // Arrange
        const input = 'maybe';

        // Act
        const result = envBool(input);

        // Assert
        expect(result).toBe('maybe');
    });

    it.each([
        ['a, b,,c', ['a', 'b', 'c']],
        [undefined, undefined],
    ])('envList(%j) returns %j (split and trimmed)', (input, expected) => {
        // Arrange: input from table

        // Act
        const result = envList(input);

        // Assert
        expect(result).toEqual(expected);
    });
});
