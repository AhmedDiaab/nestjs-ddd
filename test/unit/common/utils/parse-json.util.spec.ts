import { parseJson } from '@common/utils';

type TestType = { name: string };
describe('parseJson test suite', () => {
    it('should parse stringified json and map it to passed type', () => {
        const sut = parseJson<TestType>;
        const input = JSON.stringify({ name: 'test' });

        const result = sut(input);
        expect(result).toEqual({ name: 'test' });
    });

    it('should parse json and map it to passed type', () => {
        const sut = parseJson<TestType>;
        const input = { name: 'test' };

        const result = sut(input);
        expect(result).toEqual({ name: 'test' });
    });

    it('should parse undefined', () => {
        const sut = parseJson<TestType>;
        const input = undefined;

        const result = sut(input);
        expect(result).toBeUndefined();
    });

    it('should throw error if input not json or object', () => {
        const sut = parseJson<TestType>;
        const input = 123;
        const error = new Error('Expected JSON string or object');

        expect(() => sut(input)).toThrow(error);
    });
});
