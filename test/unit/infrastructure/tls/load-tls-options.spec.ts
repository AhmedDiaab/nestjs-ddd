import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigPort } from '@application/ports';
import { InvalidConfigError } from '@infrastructure/config';
import { loadTlsOptions } from '@infrastructure/tls';

const KEY_CONTENTS = '-----BEGIN PRIVATE KEY-----\nfake-key\n-----END PRIVATE KEY-----\n';
const CERT_CONTENTS = '-----BEGIN CERTIFICATE-----\nfake-cert\n-----END CERTIFICATE-----\n';
const CA_CONTENTS = '-----BEGIN CERTIFICATE-----\nfake-ca\n-----END CERTIFICATE-----\n';

const configWith = (values: Record<string, unknown>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigPort;

describe('loadTlsOptions', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(join(tmpdir(), 'tls-options-'));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const writeFile = (name: string, contents: string): string => {
        const path = join(dir, name);
        fs.writeFileSync(path, contents);
        return path;
    };

    it('returns undefined and reads no file when TLS is disabled', () => {
        // Arrange: `keyFile` points at a directory — reading it would throw (EISDIR), so a
        // clean `undefined` here proves the disabled path never touches the filesystem.
        const config = configWith({ 'tls.enabled': false, 'tls.keyFile': dir });

        // Act
        const options = loadTlsOptions(config);

        // Assert
        expect(options).toBeUndefined();
    });

    it('returns the key and cert as buffers when enabled with a valid pair', () => {
        // Arrange
        const keyFile = writeFile('server.key', KEY_CONTENTS);
        const certFile = writeFile('server.crt', CERT_CONTENTS);
        const config = configWith({
            'tls.enabled': true,
            'tls.keyFile': keyFile,
            'tls.certFile': certFile,
            'tls.minVersion': 'TLSv1.2',
        });

        // Act
        const options = loadTlsOptions(config);

        // Assert
        expect((options?.key as Buffer | undefined)?.toString()).toBe(KEY_CONTENTS);
        expect((options?.cert as Buffer | undefined)?.toString()).toBe(CERT_CONTENTS);
    });

    it('throws InvalidConfigError naming the path, not the contents, when the key file is missing', () => {
        // Arrange
        const certFile = writeFile('server.crt', CERT_CONTENTS);
        const missingKeyFile = join(dir, 'missing.key');
        const config = configWith({
            'tls.enabled': true,
            'tls.keyFile': missingKeyFile,
            'tls.certFile': certFile,
        });

        // Act
        let caught: unknown;
        try {
            loadTlsOptions(config);
        } catch (error) {
            caught = error;
        }

        // Assert
        expect(caught).toBeInstanceOf(InvalidConfigError);
        expect((caught as Error).message).toContain(missingKeyFile);
        expect((caught as Error).message).not.toContain(CERT_CONTENTS);
    });

    it('throws InvalidConfigError when the cert file is empty', () => {
        // Arrange
        const keyFile = writeFile('server.key', KEY_CONTENTS);
        const emptyCertFile = writeFile('empty.crt', '');
        const config = configWith({
            'tls.enabled': true,
            'tls.keyFile': keyFile,
            'tls.certFile': emptyCertFile,
        });

        // Act
        let caught: unknown;
        try {
            loadTlsOptions(config);
        } catch (error) {
            caught = error;
        }

        // Assert
        expect(caught).toBeInstanceOf(InvalidConfigError);
        expect((caught as Error).message).toContain(emptyCertFile);
    });

    it('omits ca when caFile is not set', () => {
        // Arrange
        const keyFile = writeFile('server.key', KEY_CONTENTS);
        const certFile = writeFile('server.crt', CERT_CONTENTS);
        const config = configWith({
            'tls.enabled': true,
            'tls.keyFile': keyFile,
            'tls.certFile': certFile,
        });

        // Act
        const options = loadTlsOptions(config);

        // Assert
        expect(options).not.toHaveProperty('ca');
    });

    it('includes ca as a buffer when caFile is set', () => {
        // Arrange
        const keyFile = writeFile('server.key', KEY_CONTENTS);
        const certFile = writeFile('server.crt', CERT_CONTENTS);
        const caFile = writeFile('ca.crt', CA_CONTENTS);
        const config = configWith({
            'tls.enabled': true,
            'tls.keyFile': keyFile,
            'tls.certFile': certFile,
            'tls.caFile': caFile,
        });

        // Act
        const options = loadTlsOptions(config);

        // Assert
        expect((options?.ca as Buffer | undefined)?.toString()).toBe(CA_CONTENTS);
    });

    it('passes the passphrase through', () => {
        // Arrange
        const keyFile = writeFile('server.key', KEY_CONTENTS);
        const certFile = writeFile('server.crt', CERT_CONTENTS);
        const config = configWith({
            'tls.enabled': true,
            'tls.keyFile': keyFile,
            'tls.certFile': certFile,
            'tls.passphrase': 'super-secret',
        });

        // Act
        const options = loadTlsOptions(config);

        // Assert
        expect(options?.passphrase).toBe('super-secret');
    });

    it('honours minVersion', () => {
        // Arrange
        const keyFile = writeFile('server.key', KEY_CONTENTS);
        const certFile = writeFile('server.crt', CERT_CONTENTS);
        const config = configWith({
            'tls.enabled': true,
            'tls.keyFile': keyFile,
            'tls.certFile': certFile,
            'tls.minVersion': 'TLSv1.3',
        });

        // Act
        const options = loadTlsOptions(config);

        // Assert
        expect(options?.minVersion).toBe('TLSv1.3');
    });
});
