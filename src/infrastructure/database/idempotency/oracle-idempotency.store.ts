import type { ClaimOutcome, ConfigPort, IdempotencyStorePort } from '@application/ports';
import { InvalidConfigError } from '@infrastructure/config';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { DatabaseSources } from '@infrastructure/database/sources';
import oracledb, { type Connection } from 'oracledb';

/** The table name is the one identifier SQL can't bind; this is what's safe to interpolate. */
const SAFE_TABLE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;

type ClaimRow = {
    FINGERPRINT: string;
    STATE: 'in_progress' | 'completed';
    STATUS: number | null;
    RESPONSE_BODY: string | null;
    CREATED_AT: Date;
};

function isUniqueViolation(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { errorNum?: number }).errorNum === 1 // ORA-00001
    );
}

/**
 * Shared, survives a restart: a row per key in a table owned by this service (or another
 * team's, hence the configurable name). Follows `database-info-query.dao.ts`'s conventions:
 * `ConnectionProvider`, `DatabaseSources.main`, bound values only, `OUT_FORMAT_OBJECT`, a
 * `tag` on every call.
 *
 * The claim is a single `INSERT`; its unique-constraint violation (ORA-00001) means the key
 * already exists, so we `SELECT` it and decide replay/mismatch/in-progress from there. No
 * `SELECT ... FOR UPDATE`, no advisory locks — the unique index on the primary key is the lock.
 * Expired rows are purged opportunistically on claim, so no cron job is required.
 *
 * DDL (see the idempotency guide):
 *   key VARCHAR2(128) PRIMARY KEY, fingerprint VARCHAR2(64), state VARCHAR2(16),
 *   status NUMBER, response_body CLOB, created_at TIMESTAMP, expires_at TIMESTAMP
 *   + an index on expires_at.
 */
export class OracleIdempotencyStore implements IdempotencyStorePort {
    private readonly table: string;
    private readonly ttlMs: number;
    private readonly inProgressTtlMs: number;

    constructor(
        private readonly db: ConnectionProvider,
        config: ConfigPort,
    ) {
        const table = config.get('idempotency.table');
        if (!SAFE_TABLE_NAME.test(table)) {
            throw new InvalidConfigError([
                {
                    path: 'idempotency.table',
                    code: 'invalid_identifier',
                    message:
                        'IDEMPOTENCY_TABLE must match /^[A-Za-z][A-Za-z0-9_]{0,29}$/ to be safely interpolated into SQL',
                },
            ]);
        }
        this.table = table;
        this.ttlMs = config.get('idempotency.ttlMs');
        this.inProgressTtlMs = config.get('idempotency.inProgressTtlMs');
    }

    claim(key: string, fingerprint: string): Promise<ClaimOutcome> {
        return this.db.transaction<ClaimOutcome, Connection>(
            DatabaseSources.main,
            (connection) => this.claimOn(connection, key, fingerprint),
            { tag: 'idempotency.claim' },
        );
    }

    async complete(key: string, status: number, body: unknown): Promise<void> {
        await this.db.transaction<void, Connection>(
            DatabaseSources.main,
            async (connection) => {
                await connection.execute(
                    `UPDATE ${this.table}
                        SET state = 'completed', status = :p_status, response_body = :p_body
                      WHERE key = :p_key`,
                    {
                        p_status: status,
                        p_body: body === undefined ? null : JSON.stringify(body),
                        p_key: key,
                    },
                );
            },
            { tag: 'idempotency.complete' },
        );
    }

    async release(key: string): Promise<void> {
        await this.db.transaction<void, Connection>(
            DatabaseSources.main,
            async (connection) => {
                await connection.execute(`DELETE FROM ${this.table} WHERE key = :p_key`, {
                    p_key: key,
                });
            },
            { tag: 'idempotency.release' },
        );
    }

    private async claimOn(
        connection: Connection,
        key: string,
        fingerprint: string,
    ): Promise<ClaimOutcome> {
        await this.purgeExpired(connection);

        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.ttlMs);

        const inserted = await this.tryInsert(connection, key, fingerprint, now, expiresAt);
        if (inserted) return { outcome: 'claimed' };

        const row = await this.selectRow(connection, key);
        if (!row) {
            // The conflicting row was purged between our INSERT failing and this SELECT:
            // the slot is free again.
            await connection.execute(
                this.insertSql(),
                this.insertBinds(key, fingerprint, now, expiresAt),
            );
            return { outcome: 'claimed' };
        }

        if (row.FINGERPRINT !== fingerprint) return { outcome: 'mismatch' };

        if (row.STATE === 'in_progress') {
            if (Date.now() - row.CREATED_AT.getTime() <= this.inProgressTtlMs) {
                return { outcome: 'in_progress' };
            }
            await connection.execute(
                `UPDATE ${this.table}
                    SET fingerprint = :p_fingerprint, state = 'in_progress', status = NULL,
                        response_body = NULL, created_at = :p_created, expires_at = :p_expires
                  WHERE key = :p_key`,
                { p_fingerprint: fingerprint, p_created: now, p_expires: expiresAt, p_key: key },
            );
            return { outcome: 'claimed' };
        }

        return {
            outcome: 'replay',
            status: row.STATUS ?? 200,
            body:
                row.RESPONSE_BODY === null ? undefined : (JSON.parse(row.RESPONSE_BODY) as unknown),
        };
    }

    private async purgeExpired(connection: Connection): Promise<void> {
        await connection.execute(
            `DELETE FROM ${this.table} WHERE expires_at < SYSTIMESTAMP AND ROWNUM <= 100`,
        );
    }

    private async tryInsert(
        connection: Connection,
        key: string,
        fingerprint: string,
        createdAt: Date,
        expiresAt: Date,
    ): Promise<boolean> {
        try {
            await connection.execute(
                this.insertSql(),
                this.insertBinds(key, fingerprint, createdAt, expiresAt),
            );
            return true;
        } catch (error) {
            if (isUniqueViolation(error)) return false;
            throw error;
        }
    }

    private insertSql(): string {
        return `INSERT INTO ${this.table} (key, fingerprint, state, created_at, expires_at)
                 VALUES (:p_key, :p_fingerprint, 'in_progress', :p_created, :p_expires)`;
    }

    private insertBinds(key: string, fingerprint: string, createdAt: Date, expiresAt: Date) {
        return {
            p_key: key,
            p_fingerprint: fingerprint,
            p_created: createdAt,
            p_expires: expiresAt,
        };
    }

    private async selectRow(connection: Connection, key: string): Promise<ClaimRow | undefined> {
        const { rows } = await connection.execute<ClaimRow>(
            `SELECT fingerprint, state, status, response_body, created_at
               FROM ${this.table}
              WHERE key = :p_key`,
            { p_key: key },
            {
                outFormat: oracledb.OUT_FORMAT_OBJECT,
                fetchInfo: { RESPONSE_BODY: { type: oracledb.STRING } },
            },
        );
        return rows?.[0];
    }
}
