// Framework dependent type utils

import type { Provider } from '@nestjs/common';

export type DIToken = string | symbol;

export type Provide<Token extends DIToken, Instance> = Provider & {
    provide: Token;
    useFactory?: () => Instance;
    useClass?: new (...args: any[]) => Instance;
};
