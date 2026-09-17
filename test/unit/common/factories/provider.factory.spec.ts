import { ProviderFactory } from '@common/factories';

describe('ProviderFactory test suite', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should clone the inject array', () => {
        const inject = ['P1', 'P2'];
        const provider = ProviderFactory.factory('TEST', () => {}, inject);

        expect(provider.inject).toEqual(inject);
        expect(provider.inject).not.toBe(inject); // for different ref
    });

    it('should inject to an empty array', () => {
        const provider = ProviderFactory.factory('TEST', () => {}, []);

        expect(provider.inject).toEqual([]);
    });
});
