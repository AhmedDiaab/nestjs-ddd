import type { OracleDriverConfig } from '@infrastructure/config/schemas';
import oracledb from 'oracledb';

let initialized = false;

/**
 * Applies process-wide node-oracledb settings once, before the first pool is created.
 * Thick mode cannot be enabled after any thin connection exists, so this must run first.
 */
export function initOracleDriver(config: OracleDriverConfig): void {
    if (initialized) return;

    if (config.thickMode) {
        oracledb.initOracleClient({
            libDir: config.clientLibDir,
            configDir: config.clientConfigDir,
        });
    }

    if (config.fetchAsString.length) {
        const types = {
            CLOB: oracledb.CLOB,
            NCLOB: oracledb.NCLOB,
            NUMBER: oracledb.NUMBER,
            DATE: oracledb.DATE,
            JSON: oracledb.DB_TYPE_JSON,
        };
        oracledb.fetchAsString = config.fetchAsString.map(
            (type) => types[type],
        ) as typeof oracledb.fetchAsString;
    }

    if (config.fetchAsBuffer.length) {
        oracledb.fetchAsBuffer = [oracledb.BLOB];
    }

    initialized = true;
}

/** test-only */
export function resetOracleDriverInit(): void {
    initialized = false;
}
