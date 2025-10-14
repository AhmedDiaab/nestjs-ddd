import type { DIToken, Provide } from '@common/type-utils';
import type { Constructor } from '@shared/type-utils';

export class ProviderFactory {
    static create<Token extends DIToken, TargetClass>(
        token: Token,
        useClass: Constructor<TargetClass>,
    ): Provide<Token, TargetClass> {
        return {
            provide: token,
            useClass: useClass,
        };
    }
}
