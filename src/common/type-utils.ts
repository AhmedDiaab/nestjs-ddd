// Framework dependent type utils
import type {
    ClassProvider,
    ExistingProvider,
    FactoryProvider,
    ValueProvider,
} from '@nestjs/common';

/**
 * Any value Nest accepts as a provider key (type only).
 * - `TypedToken<T>` (from `@shared`): our port tokens, checked against the bound class/factory
 * - plain `string`/`symbol`: Nest's own tokens (`APP_GUARD`, `APP_FILTER`...) and legacy keys
 */
export type DIToken = string | symbol;

/**
 * Our providers only ever produce one of these concrete shapes.
 * We intentionally avoid intersecting with Nest's broad `Provider` union,
 * because that causes type widening and false positives (e.g., "useExisting missing").
 */
export type Provide<Token extends DIToken, Instance> =
    | (ClassProvider<Instance> & { provide: Token })
    | (FactoryProvider<Instance> & { provide: Token })
    | (ValueProvider<Instance> & { provide: Token })
    | (ExistingProvider<Instance> & { provide: Token });

export type ClassProvide<Token extends DIToken, Instance> = ClassProvider<Instance> & {
    provide: Token;
};

export type FactoryProvide<Token extends DIToken, Instance> = FactoryProvider<Instance> & {
    provide: Token;
};

export type ValueProvide<Token extends DIToken, Instance> = ValueProvider<Instance> & {
    provide: Token;
};

export type ExistingProvide<Token extends DIToken, Instance> = ExistingProvider<Instance> & {
    provide: Token;
};
