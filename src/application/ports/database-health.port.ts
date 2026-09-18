import { createToken } from '@shared';

/** Per-source health, decoupled from the driver's own `SourceHealth` shape. */
export type SourceHealthView = {
    key: string;
    dialect: string;
    implemented: boolean;
    ok: boolean;
    latencyMs?: number;
    error?: string;
};

export interface DatabaseHealthPort {
    check(timeoutMs?: number): Promise<readonly SourceHealthView[]>;
}

export const DatabaseHealthPortToken = createToken<DatabaseHealthPort>('DatabaseHealthPort');
