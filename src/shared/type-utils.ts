export type Awaitable<T> = T | Promise<T>;

export type Constructor<T> = new (...args: unknown[]) => T;

export type Rec = Record<string, unknown>;
