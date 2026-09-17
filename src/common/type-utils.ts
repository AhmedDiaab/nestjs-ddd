// Framework dependent type utils
import type {
    ClassProvider,
    ExistingProvider,
    FactoryProvider,
    ValueProvider,
} from '@nestjs/common';

// A DI token is string or symobol used to inject by token
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

/** Narrow utility types if you need them elsewhere */
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
