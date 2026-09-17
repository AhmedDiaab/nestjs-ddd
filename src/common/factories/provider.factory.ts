import type {
    ClassProvide,
    DIToken,
    ExistingProvide,
    FactoryProvide,
    Provide,
    ValueProvide,
} from '@common/type-utils';
import type { InjectionToken, OptionalFactoryDependency } from '@nestjs/common';
import type { Constructor } from '@shared';

/**
 * Factory of typed Nest providers.
 *
 * This helper offers strongly-typed shorthands for the common provider patterns:
 * - `class()`    → useClass (constructor)
 * - `factory()`  → useFactory (variadic, supports `inject`)
 * - `value()`    → useValue (constant/singleton)
 * - `existing()` → useExisting (alias another provider)
 *
 * Notes:
 * - `Token` is your DI token type (string/symbol/Type), `T` is the instance type.
 * - `inject` controls the parameters passed to your `useFactory` function.
 */
export class ProviderFactory {
    /**
     * Create a `useClass` provider.
     *
     * @typeParam Token - The DI token type (string/symbol/Type).
     * @typeParam T - The instance/class type produced by the provider.
     *
     * @param token - The DI token to bind.
     * @param useClass - The concrete class/constructor to instantiate.
     * @returns A typed `useClass` provider.
     *
     * @example
     * ProviderFactory.class(SHIFT_READ_PORT, OracleShiftReadAdapter)
     */
    static class<Token extends DIToken, T>(
        token: Token,
        useClass: Constructor<T>,
    ): ClassProvide<Token, T> {
        return {
            provide: token,
            useClass,
        };
    }

    /**
     * Create a `useFactory` provider (supports DI via `inject`).
     *
     * The factory can be sync or async. The `inject` array determines the
     * arguments passed to `useFactory` in order.
     *
     * @typeParam Token - The DI token type (string/symbol/Type).
     * @typeParam T - The instance type produced by the factory.
     *
     * @param token - The DI token to bind.
     * @param useFactory - Factory function (variadic). Receives values for each token in `inject`.
     * @param inject - Tokens (and/or optional deps) to resolve and pass to the factory.
     * @returns A typed `useFactory` provider.
     *
     * @example
     * ProviderFactory.factory(
     *   CONNECTION_PROVIDER,
     *   async (cfg: ConfigPort, mgr: MultiDialectPoolManager) => { ... },
     *   [ConfigPortToken, MultiDialectPoolManager],
     * )
     */
    static factory<Token extends DIToken, T>(
        token: Token,
        useFactory: (...args: any[]) => T | Promise<T>,
        inject: ReadonlyArray<InjectionToken | OptionalFactoryDependency> = [],
    ): FactoryProvide<Token, T> {
        return {
            provide: token,
            useFactory,
            // spread to avoid accidental outside mutation of the array
            inject: [...inject],
        };
    }

    /**
     * Create a `useValue` provider (constant).
     *
     * @typeParam Token - The DI token type (string/symbol/Type).
     * @typeParam T - The instance/value type.
     *
     * @param token - The DI token to bind.
     * @param value - The constant value to provide.
     * @returns A typed `useValue` provider.
     *
     * @example
     * ProviderFactory.value(APP_CONFIG_TOKEN, loadConfig())
     */
    static value<Token extends DIToken, T>(token: Token, value: T): ValueProvide<Token, T> {
        return {
            provide: token,
            useValue: value,
        };
    }

    /**
     * Create a `useExisting` provider (alias an existing provider).
     *
     * Useful for exposing one implementation under multiple tokens.
     *
     * @typeParam Token - The DI token type (string/symbol/Type).
     * @typeParam T - The instance type (should match the existing provider’s type).
     *
     * @param token - The alias token to bind.
     * @param existing - An existing token to re-expose.
     * @returns A typed `useExisting` provider.
     *
     * @example
     * ProviderFactory.existing(CACHE_PORT, REDIS_CACHE_ADAPTER_TOKEN)
     */
    static existing<Token extends DIToken, T>(
        token: Token,
        existing: DIToken,
    ): ExistingProvide<Token, T> {
        return {
            provide: token,
            // Casting to InjectionToken is safe for Nest consumption.
            useExisting: existing as InjectionToken,
        };
    }

    /**
     * Same as top-level `provideMany`, exposed for a fluent style.
     *
     * @param providers - One or more providers to bundle.
     * @returns The providers array.
     */
    static many(...providers: Provide<any, any>[]) {
        return providers;
    }
}
