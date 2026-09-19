import { readFileSync } from 'node:fs';
import type { SecureContextOptions } from 'node:tls';
import type { ConfigPort } from '@application/ports';
import { InvalidConfigError } from '@infrastructure/config';

/** Reads one PEM file from disk. Failures name the path only, never the file's contents. */
function readPemFile(path: string, variable: string): Buffer {
    let contents: Buffer;
    try {
        contents = readFileSync(path);
    } catch {
        throw new InvalidConfigError([
            { path: variable, code: 'custom', message: `cannot read ${variable} at "${path}"` },
        ]);
    }
    if (contents.length === 0) {
        throw new InvalidConfigError([
            { path: variable, code: 'custom', message: `${variable} at "${path}" is empty` },
        ]);
    }
    return contents;
}

/**
 * Builds the Node TLS options Nest passes straight to `https.createServer`. `undefined` when
 * `TLS_ENABLED` is off — the default, terminated-upstream case (`docs/architecture/operations.md`
 * § TLS). Reads happen eagerly, at bootstrap, so a bad path fails at boot rather than on the
 * first request.
 */
export function loadTlsOptions(config: ConfigPort): SecureContextOptions | undefined {
    if (!config.get('tls.enabled')) return undefined;

    const keyFile = config.get('tls.keyFile')!;
    const certFile = config.get('tls.certFile')!;
    const caFile = config.get('tls.caFile');
    const passphrase = config.get('tls.passphrase');

    const key = readPemFile(keyFile, 'TLS_KEY_FILE');
    const cert = readPemFile(certFile, 'TLS_CERT_FILE');

    return {
        key,
        cert,
        ...(caFile ? { ca: readPemFile(caFile, 'TLS_CA_FILE') } : {}),
        ...(passphrase ? { passphrase } : {}),
        minVersion: config.get('tls.minVersion'),
    };
}
