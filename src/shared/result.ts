export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };

export type Result<T, E> = Ok<T> | Err<E>;

export const Result = {
    ok<T>(value: T): Ok<T> {
        return { ok: true, value };
    },
    err<E>(error: E): Err<E> {
        return { ok: false, error };
    },
    map<T, U, E>(result: Result<T, E>, func: (value: T) => U): Result<U, E> {
        return result.ok ? Result.ok(func(result.value)) : result;
    },
    mapErr<T, E, F>(result: Result<T, E>, func: (error: E) => F): Result<T, F> {
        return result.ok ? result : Result.err(func(result.error));
    },
    // fails fast in the first error; useful for multistep validation
    combine<T, E>(results: Result<T, E>[]): Result<T[], E> {
        const values: T[] = [];
        for (const result of results) {
            if (!result.ok) return result;
            values.push(result.value);
        }
        return Result.ok(values);
    },
    // convenience for more readable code
    isOk<T, E>(result: Result<T, E>): result is Ok<T> {
        return result.ok;
    },
    isErr<T, E>(result: Result<T, E>): result is Err<E> {
        return !result.ok;
    },
};
