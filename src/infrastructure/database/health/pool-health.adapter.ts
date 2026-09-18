import type { DatabaseHealthPort, SourceHealthView } from '@application/ports';
import type { ConnectionProvider } from '@infrastructure/database/contracts';

/** Wraps `ConnectionProvider.health()`, mapping the driver-facing shape to the application view. */
export class PoolHealthAdapter implements DatabaseHealthPort {
    constructor(private readonly db: ConnectionProvider) {}

    async check(timeoutMs?: number): Promise<readonly SourceHealthView[]> {
        const sources = await this.db.health(timeoutMs);

        return sources.map((source) => ({
            key: source.sourceKey,
            dialect: source.dialect,
            implemented: source.implemented,
            ok: source.ok,
            latencyMs: source.latencyMs,
            error: source.error,
        }));
    }
}
