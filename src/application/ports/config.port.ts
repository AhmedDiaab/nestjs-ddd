/**
 * Shape of the validated configuration. Empty here on purpose: infrastructure fills it in with
 * the Zod-inferred config type through declaration merging (see
 * `infrastructure/config/config-values.ts`), so application code gets typed keys without
 * importing infrastructure.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by infrastructure
export interface ConfigValues {}

type Leaf =
    | string
    | number
    | boolean
    | bigint
    | symbol
    | null
    | undefined
    | Date
    | readonly unknown[];

/** Every dot path into `T`, e.g. `'http'`, `'http.port'`, `'database.health.timeoutMs'`. */
export type ConfigKey<T = ConfigValues> = {
    [K in keyof T & string]: NonNullable<T[K]> extends Leaf
        ? K
        : K | `${K}.${ConfigKey<NonNullable<T[K]>>}`;
}[keyof T & string];

/** Value type at a dot path; `undefined` is kept when any segment on the way is optional. */
export type ConfigValue<
    K extends string,
    T = ConfigValues,
> = K extends `${infer Head}.${infer Rest}`
    ? Head extends keyof T
        ? ConfigValue<Rest, NonNullable<T[Head]>> | (undefined extends T[Head] ? undefined : never)
        : never
    : K extends keyof T
      ? T[K]
      : never;

export interface ConfigPort {
    isDevelopment(): boolean;
    isProduction(): boolean;
    /** Typed dot-path access: `get('http.port')` is a `number`; unknown keys don't compile. */
    get<K extends ConfigKey>(key: K): ConfigValue<K>;
    all(): ConfigValues;
}
