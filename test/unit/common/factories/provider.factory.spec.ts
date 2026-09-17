import { ProviderFactory } from '@common/factories';
import { createToken } from '@shared';
import { EnglishGreeter, type Greeter } from '../../../fixtures/di/english-greeter';
import { SimpleCounter, type Counter } from '../../../fixtures/di/simple-counter';

const GreeterToken = createToken<Greeter>('test:Greeter');
const CounterToken = createToken<Counter>('test:Counter');

describe('ProviderFactory test suite', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should clone the inject array', () => {
        // Arrange
        const inject = ['P1', 'P2'];

        // Act
        const provider = ProviderFactory.factory('TEST', () => {}, inject);

        // Assert
        expect(provider.inject).toEqual(inject);
        expect(provider.inject).not.toBe(inject); // for different ref
    });

    it('should inject to an empty array', () => {
        // Arrange
        const inject: string[] = [];

        // Act
        const provider = ProviderFactory.factory('TEST', () => {}, inject);

        // Assert
        expect(provider.inject).toEqual([]);
    });

    describe('typed tokens (checked by tsc: `pnpm exec tsc --noEmit`)', () => {
        it('binds a class that matches the token type', () => {
            // Arrange
            const implementation = EnglishGreeter;

            // Act
            const provider = ProviderFactory.class(GreeterToken, implementation);

            // Assert
            expect(provider).toEqual({ provide: GreeterToken, useClass: EnglishGreeter });
        });

        it('binds a factory that matches the token type', () => {
            // Arrange
            const factory = () => new SimpleCounter();

            // Act
            const provider = ProviderFactory.factory(CounterToken, factory);

            // Assert
            expect(provider).toMatchObject({ provide: CounterToken });
        });

        it('binds a value that matches the token type', () => {
            // Arrange
            const value = { count: () => 2 };

            // Act
            const provider = ProviderFactory.value(CounterToken, value);

            // Assert
            expect(provider.useValue.count()).toBe(2);
        });

        it('rejects implementations that do not match the token type', () => {
            // Arrange: each binding below is a compile error, verified by `pnpm typecheck`

            // Act
            const wrongBindings = [
                // @ts-expect-error SimpleCounter is not a Greeter
                ProviderFactory.class(GreeterToken, SimpleCounter),
                // @ts-expect-error factory returns a Counter, token wants a Greeter
                ProviderFactory.factory(GreeterToken, () => new SimpleCounter()),
                // @ts-expect-error value is not a Counter
                ProviderFactory.value(CounterToken, { greet: () => 'x' }),
                // @ts-expect-error cannot alias a Greeter token to a Counter token
                ProviderFactory.existing(GreeterToken, CounterToken),
            ];

            // Assert
            expect(wrongBindings).toHaveLength(4);
        });

        it('creates equal tokens for the same name', () => {
            // Arrange
            const name = 'test:Greeter';

            // Act
            const token = createToken<Greeter>(name);

            // Assert
            expect(token).toBe(GreeterToken);
        });
    });
});
