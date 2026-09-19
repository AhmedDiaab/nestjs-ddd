declare const tokenType: unique symbol;

/**
 * DI token that carries the type it resolves to (phantom type, no runtime cost).
 * Lets provider helpers reject binding a class that does not implement the port.
 * Framework-free: usable from domain and application.
 */
export type TypedToken<T> = symbol & { readonly [tokenType]?: T };

/** `Symbol.for` keeps tokens equal across duplicate module instances (jest, hot reload). */
export function createToken<T>(name: string): TypedToken<T> {
    return Symbol.for(name);
}
