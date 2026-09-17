import { UnsupportedDialectError } from '@infrastructure/database/errors';
import type { DatabaseClient } from './database-client.interface';

/** Placeholder for not-yet-implemented dialects: throws a typed error when used */
export class NotImplementedClient implements DatabaseClient {
    readonly implemented = false;

    constructor(
        private readonly sourceKey: string,
        private readonly dialect: string,
    ) {}

    withConnection<T, C>(_fn: (conn: C) => Promise<T>): Promise<T> {
        void _fn;
        return Promise.reject(new UnsupportedDialectError(this.sourceKey, this.dialect));
    }

    transaction<T, C>(_fn: (conn: C) => Promise<T>): Promise<T> {
        void _fn;
        return Promise.reject(new UnsupportedDialectError(this.sourceKey, this.dialect));
    }

    mapError(error: unknown): unknown {
        return error;
    }

    ping(): Promise<void> {
        return Promise.reject(new UnsupportedDialectError(this.sourceKey, this.dialect));
    }

    stats(): undefined {
        return undefined;
    }

    async close(): Promise<void> {
        /* no-op */
    }
}
