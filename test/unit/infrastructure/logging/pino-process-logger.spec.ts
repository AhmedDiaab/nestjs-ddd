import type { ConfigPort } from '@application/ports';
// Imported from its own file, not the `@infrastructure/logging` barrel: the barrel also exports
// `PinoLoggerAdapter`, which pulls in `nestjs-pino` → `pino-http` → the real `pino` internals
// (e.g. its `stringifySym`) that the `jest.mock('pino', ...)` below would otherwise break.
import { PinoProcessLogger } from '@infrastructure/logging/pino-process-logger';
import pino from 'pino';

jest.mock('pino', () => jest.fn());

const mockedPino = pino as unknown as jest.Mock;

const record = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const configStub = {
    get: (key: string) =>
        (
            ({
                'logging.logLevel': 'warn',
                'logging.toFile': false,
                'logging.pretty': false,
            }) as Record<string, unknown>
        )[key],
    isDevelopment: () => false,
    isProduction: () => true,
    all: () => ({}),
} as unknown as ConfigPort;

describe('PinoProcessLogger', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedPino.mockReturnValue(record);
    });

    it('builds a plain pino instance at the configured level', () => {
        // Arrange & Act
        const sut = new PinoProcessLogger(configStub);

        // Assert
        expect(sut).toBeInstanceOf(PinoProcessLogger);
        expect(mockedPino).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
    });

    it('logs info with (meta, message) argument order, matching PinoLoggerAdapter', () => {
        // Arrange
        const sut = new PinoProcessLogger(configStub);

        // Act
        sut.info('cluster.worker.started', { id: 1 });

        // Assert
        expect(record.info).toHaveBeenCalledWith({ id: 1 }, 'cluster.worker.started');
    });

    it('logs warn with (meta, message) argument order', () => {
        // Arrange
        const sut = new PinoProcessLogger(configStub);

        // Act
        sut.warn('cluster.leader.lost', { id: 2 });

        // Assert
        expect(record.warn).toHaveBeenCalledWith({ id: 2 }, 'cluster.leader.lost');
    });

    it('logs error with (meta, message) argument order', () => {
        // Arrange
        const sut = new PinoProcessLogger(configStub);

        // Act
        sut.error('cluster.metrics.server.failed', { port: 9091 });

        // Assert
        expect(record.error).toHaveBeenCalledWith({ port: 9091 }, 'cluster.metrics.server.failed');
    });

    it('logs debug with an empty object when no meta is given', () => {
        // Arrange
        const sut = new PinoProcessLogger(configStub);

        // Act
        sut.debug('cluster.worker.started');

        // Assert
        expect(record.debug).toHaveBeenCalledWith({}, 'cluster.worker.started');
    });
});
