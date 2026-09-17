import { ProviderFactory } from '@common/factories';
import { createToken } from '@shared';

interface Greeter {
    greet(): string;
}
interface Counter {
    count(): number;
}
class EnglishGreeter implements Greeter {
    constructor(private readonly name: string) {}
    greet() {
        return `hi ${this.name}`;
    }
}
class SimpleCounter implements Counter {
    count() {
        return 1;
    }
}

const GreeterToken = createToken<Greeter>('test:Greeter');
const CounterToken = createToken<Counter>('test:Counter');

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

    describe('typed tokens (checked by tsc: `pnpm exec tsc --noEmit`)', () => {
        it('binds implementations that match the token type', () => {
            expect(ProviderFactory.class(GreeterToken, EnglishGreeter)).toEqual({
                provide: GreeterToken,
                useClass: EnglishGreeter,
            });
            expect(ProviderFactory.factory(CounterToken, () => new SimpleCounter())).toMatchObject({
                provide: CounterToken,
            });
            expect(ProviderFactory.value(CounterToken, { count: () => 2 }).useValue.count()).toBe(
                2,
            );
        });

        it('rejects implementations that do not match the token type', () => {
            // @ts-expect-error SimpleCounter is not a Greeter
            const wrongClass = ProviderFactory.class(GreeterToken, SimpleCounter);
            // @ts-expect-error factory returns a Counter, token wants a Greeter
            const wrongFactory = ProviderFactory.factory(GreeterToken, () => new SimpleCounter());
            // @ts-expect-error value is not a Counter
            const wrongValue = ProviderFactory.value(CounterToken, { greet: () => 'x' });
            // @ts-expect-error cannot alias a Greeter token to a Counter token
            const wrongAlias = ProviderFactory.existing(GreeterToken, CounterToken);

            expect([wrongClass, wrongFactory, wrongValue, wrongAlias]).toHaveLength(4);
        });

        it('creates equal tokens for the same name', () => {
            expect(createToken<Greeter>('test:Greeter')).toBe(GreeterToken);
        });
    });
});
