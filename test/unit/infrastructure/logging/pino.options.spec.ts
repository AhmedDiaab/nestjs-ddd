import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConfigPort } from '@application/ports';
import { generatePinoOptions, isHealthCheck } from '@infrastructure/logging/pino.options';
import type { Options as PinoHttpOptions } from 'pino-http';

describe('pino options', () => {
    it.each([
        ['/health', true],
        ['/health/', true],
        ['/health/ready', true],
        ['/health/ready?probe=1', true],
        ['/v1/health', false],
        ['/healthz', false],
        ['/health/other', false],
        [undefined, false],
    ])('isHealthCheck(%j) returns %j', (url, expected) => {
        // Arrange: url from table

        // Act
        const result = isHealthCheck(url);

        // Assert
        expect(result).toBe(expected);
    });

    describe('customLogLevel', () => {
        const config = {
            get: () => undefined,
            isDevelopment: () => false,
            isProduction: () => true,
            all: () => ({}),
        } as unknown as ConfigPort;
        const options = generatePinoOptions(config).pinoHttp as PinoHttpOptions;
        const level = (url: string, statusCode: number) =>
            options.customLogLevel!(
                { url } as IncomingMessage,
                { statusCode } as ServerResponse,
                undefined,
            );

        it.each([
            ['silences successful health polls', '/health', 200, 'silent'],
            ['still logs failing health checks', '/health/ready', 503, 'error'],
            ['logs normal requests', '/v1/orders', 200, 'info'],
        ])('%s', (_case, url, statusCode, expected) => {
            // Arrange: request from table

            // Act
            const result = level(url, statusCode);

            // Assert
            expect(result).toBe(expected);
        });
    });
});
