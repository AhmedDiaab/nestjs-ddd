import { envBool, envList, envString } from '@infrastructure/config/env.util';

describe('env helpers', () => {
    it('envString treats blank as unset', () => {
        expect(envString('  ')).toBeUndefined();
        expect(envString(' a ')).toBe('a');
    });

    it('envBool parses common spellings and leaves unset undefined', () => {
        expect(envBool(undefined)).toBeUndefined();
        expect(envBool('')).toBeUndefined();
        expect(envBool('TRUE')).toBe(true);
        expect(envBool('0')).toBe(false);
    });

    it('envBool passes invalid input through so validation fails loudly', () => {
        expect(envBool('maybe')).toBe('maybe');
    });

    it('envList splits and trims', () => {
        expect(envList('a, b,,c')).toEqual(['a', 'b', 'c']);
        expect(envList(undefined)).toBeUndefined();
    });
});
