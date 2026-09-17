import type {
    ClassProvide,
    DIToken,
    ExistingProvide,
    FactoryProvide,
    Provide,
    ValueProvide,
} from '@common/type-utils';
import type { InjectionToken, OptionalFactoryDependency } from '@nestjs/common';
import type { Constructor, TypedToken } from '@shared';

type Inject = ReadonlyArray<InjectionToken | OptionalFactoryDependency>;

/**
 * Factory of typed Nest providers.
 *
 * - `class()`    → useClass (constructor)
 * - `factory()`  → useFactory (variadic, supports `inject`)
 * - `value()`    → useValue (constant/singleton)
 * - `existing()` → useExisting (alias another provider)
 *
 * With a `TypedToken<T>` the bound class/factory/value must produce `T`
 * (`NoInfer` makes the token, not the implementation, decide `T`):
 *
 * @example
 * ProviderFactory.class(ConfigPortToken, EnvConfigAdapter)   // ok
 * ProviderFactory.class(ConfigPortToken, PinoLoggerAdapter)  // compile error
 *
 * Plain string tokens (Nest's `APP_GUARD`, `APP_FILTER`...) are accepted unchecked.
 */
export class ProviderFactory {
    static class<T>(
        token: TypedToken<T>,
        useClass: Constructor<NoInfer<T>>,
    ): ClassProvide<TypedToken<T>, T>;
    static class<T>(token: string, useClass: Constructor<T>): ClassProvide<string, T>;
    static class<T>(token: DIToken, useClass: Constructor<T>): ClassProvide<DIToken, T> {
        return {
            provide: token,
            useClass,
        };
    }

    static factory<T>(
        token: TypedToken<T>,
        useFactory: (...args: any[]) => NoInfer<T> | Promise<NoInfer<T>>,
        inject?: Inject,
    ): FactoryProvide<TypedToken<T>, T>;
    static factory<T>(
        token: string,
        useFactory: (...args: any[]) => T | Promise<T>,
        inject?: Inject,
    ): FactoryProvide<string, T>;
    static factory<T>(
        token: DIToken,
        useFactory: (...args: any[]) => T | Promise<T>,
        inject: Inject = [],
    ): FactoryProvide<DIToken, T> {
        return {
            provide: token,
            useFactory,
            // spread to avoid accidental outside mutation of the array
            inject: [...inject],
        };
    }

    static value<T>(token: TypedToken<T>, value: NoInfer<T>): ValueProvide<TypedToken<T>, T>;
    static value<T>(token: string, value: T): ValueProvide<string, T>;
    static value<T>(token: DIToken, value: T): ValueProvide<DIToken, T> {
        return {
            provide: token,
            useValue: value,
        };
    }

    /** Alias an existing provider, e.g. expose one adapter under two port tokens. */
    static existing<T>(
        token: TypedToken<T>,
        existing: TypedToken<NoInfer<T>>,
    ): ExistingProvide<TypedToken<T>, T>;
    static existing<T>(token: string, existing: DIToken): ExistingProvide<string, T>;
    static existing<T>(token: DIToken, existing: DIToken): ExistingProvide<DIToken, T> {
        return {
            provide: token,
            // Casting to InjectionToken is safe for Nest consumption.
            useExisting: existing as InjectionToken,
        };
    }

    static many(...providers: Provide<any, any>[]) {
        return providers;
    }
}
