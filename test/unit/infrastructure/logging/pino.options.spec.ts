import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ConfigPort } from '@application/ports';
import { formatStackTrace } from '@common/utils';
import { generatePinoOptions, isHealthCheck } from '@infrastructure/logging/pino.options';
import type { Options as PinoHttpOptions } from 'pino-http';

const createConfigStub = (showStackTraces: boolean): ConfigPort =>
    ({
        get: (key: string) => (key === 'logging.showStackTraces' ? showStackTraces : undefined),
        isDevelopment: () => false,
        isProduction: () => true,
        all: () => ({}),
    }) as unknown as ConfigPort;

type SerializedError = {
    type: string;
    message: string;
    origin?: string;
    causeOrigin?: string;
    stack?: string;
};

const errorSerializerFor = (config: ConfigPort): ((value: unknown) => SerializedError) => {
    const options = generatePinoOptions(config).pinoHttp as PinoHttpOptions;
    return options.serializers?.error as (value: unknown) => SerializedError;
};

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

    describe('serializers.error', () => {
        const errorWithOrigin = () => {
            const error = new Error('boom');
            error.stack =
                'Error: boom\n    at TicketService.close (/repo/src/domain/tickets/close.ts:42:11)';
            return error;
        };

        it('reports type, message and origin without a stack when stack traces are disabled', () => {
            // Arrange
            const serialize = errorSerializerFor(createConfigStub(false));
            const error = errorWithOrigin();

            // Act
            const serialized = serialize(error);

            // Assert
            expect(serialized).toEqual({
                type: 'Error',
                message: 'boom',
                origin: 'src/domain/tickets/close.ts:42 (TicketService.close)',
                causeOrigin: undefined,
                stack: undefined,
            });
        });

        it('includes the trimmed stack when stack traces are enabled', () => {
            // Arrange
            const serialize = errorSerializerFor(createConfigStub(true));
            const error = errorWithOrigin();

            // Act
            const serialized = serialize(error);

            // Assert
            expect(serialized).toMatchObject({
                type: 'Error',
                message: 'boom',
                origin: 'src/domain/tickets/close.ts:42 (TicketService.close)',
                stack: formatStackTrace(error.stack),
            });
        });

        it('reports the cause origin alongside the origin when they differ', () => {
            // Arrange
            const serialize = errorSerializerFor(createConfigStub(false));
            const cause = new Error('ORA-12345');
            cause.stack =
                'Error: ORA-12345\n    at Connection.execute (/repo/node_modules/oracledb/lib/connection.js:512:23)\n    at OracleTicketsDao.findById (/repo/src/infrastructure/database/dao/oracle-tickets.dao.ts:77:9)';
            const error = Object.assign(new Error('DB execution failed'), { cause });
            error.stack =
                'Error: DB execution failed\n    at OracleTicketsDao.findById (/repo/src/infrastructure/database/dao/oracle-tickets.dao.ts:80:15)';

            // Act
            const serialized = serialize(error);

            // Assert
            expect(serialized).toMatchObject({
                origin: 'src/infrastructure/database/dao/oracle-tickets.dao.ts:80 (OracleTicketsDao.findById)',
                causeOrigin:
                    'src/infrastructure/database/dao/oracle-tickets.dao.ts:77 (OracleTicketsDao.findById)',
            });
        });

        it('serializes a non-Error thrown value without crashing', () => {
            // Arrange
            const serialize = errorSerializerFor(createConfigStub(false));

            // Act
            const serialized = serialize('just a string');

            // Assert
            expect(serialized).toMatchObject({ type: 'string', message: 'just a string' });
        });

        it('unwraps a pino-http pre-serialized error (its own `err`-key wrapping) to read the real stack', () => {
            // Arrange: pino-std-serializers' default err serializer runs BEFORE ours on the
            // `err` key (pino-http's own wrapErrorSerializer), flattening the error to
            // { type, message, stack, raw: <original> } — `raw` is what we must read from.
            const serialize = errorSerializerFor(createConfigStub(false));
            const original = errorWithOrigin();
            const preSerialized = { type: 'Error', message: original.message, raw: original };

            // Act
            const serialized = serialize(preSerialized);

            // Assert
            expect(serialized).toMatchObject({
                type: 'Error',
                message: 'boom',
                origin: 'src/domain/tickets/close.ts:42 (TicketService.close)',
            });
        });
    });

    describe('serializers.err', () => {
        // pino-http builds its own automatic access-log line under the literal key `err`
        // (see logger.js: `[errKey]: error` with `errKey` defaulting to 'err') — a key this
        // template does not control. Registering the same serializer there keeps that line
        // trimmed to { type, message, origin, causeOrigin?, stack? } too, instead of falling
        // back to pino's default full-stack serializer.
        it('is registered as the same serializer used for our own `error` key', () => {
            // Arrange
            const options = generatePinoOptions(createConfigStub(false))
                .pinoHttp as PinoHttpOptions;

            // Act
            const serializerAtLegacyKey = options.serializers?.err;
            const serializerAtOurKey = options.serializers?.error;

            // Assert
            expect(serializerAtLegacyKey).toBe(serializerAtOurKey);
        });
    });
});
