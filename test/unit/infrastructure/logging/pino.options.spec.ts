import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConfigPort } from '@application/ports';
import { generatePinoOptions, isHealthCheck } from '@infrastructure/logging/pino.options';
import type { Options as PinoHttpOptions } from 'pino-http';

describe('pino options', () => {
    it.each(['/health', '/health/', '/health/ready', '/health/ready?probe=1'])(
        'treats %s as a health check',
        (url) => expect(isHealthCheck(url)).toBe(true),
    );

    it.each(['/v1/health', '/healthz', '/health/other', undefined])(
        'does not treat %s as one',
        (url) => expect(isHealthCheck(url)).toBe(false),
    );

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

        it('silences successful health polls', () => {
            expect(level('/health', 200)).toBe('silent');
        });

        it('still logs failing health checks', () => {
            expect(level('/health/ready', 503)).toBe('error');
        });

        it('logs normal requests', () => {
            expect(level('/v1/orders', 200)).toBe('info');
        });
    });
});
