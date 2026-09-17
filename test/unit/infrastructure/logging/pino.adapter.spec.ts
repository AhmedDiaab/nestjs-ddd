import { PinoLoggerAdapter } from '@infrastructure/logging';
import type { PinoLogger } from 'nestjs-pino';

describe('PinoLoggerAdapter', () => {
    const pino = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const sut = new PinoLoggerAdapter(pino as unknown as PinoLogger);

    afterEach(() => jest.clearAllMocks());

    it.each(['info', 'warn', 'error'] as const)(
        'passes %s meta as the merged object, so the fields reach the log line',
        (level) => {
            // Arrange
            const meta = { sourceKey: 'main', latencyMs: 4 };

            // Act
            sut[level]('database.ping.ok', meta);

            // Assert: pino merges the first argument; passing it second would drop it silently
            expect(pino[level]).toHaveBeenCalledWith(meta, 'database.ping.ok');
        },
    );

    it('logs debug without meta as an empty object', () => {
        // Arrange: a debug line with nothing to attach

        // Act
        sut.debug('cache.miss');

        // Assert
        expect(pino.debug).toHaveBeenCalledWith({}, 'cache.miss');
    });
});
