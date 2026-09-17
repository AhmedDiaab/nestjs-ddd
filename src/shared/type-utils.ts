export type Awaitable<T> = T | Promise<T>;

/** Any class producing T. `any[]` args: a class with typed constructor params is not assignable to `unknown[]` under strictFunctionTypes. */
export type Constructor<T> = new (...args: any[]) => T;

export type Rec = Record<string, unknown>;

export type Maybe<T> = T | undefined;

export type Nullable<T> = T | null;
