import { toString } from '@common/utils';

describe('toString test suite', () => {
    it('should parse term as string and return it as String object', () => {
        const sut = toString;

        const result = sut(123);
        expect(result).toBe('123');
    });

    it('should return null if term is null', () => {
        const sut = toString;

        const result = sut(null);
        expect(result).toBeNull();
    });
});
