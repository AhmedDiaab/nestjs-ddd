import type { RequestContext, RequestContextPort } from '@application/ports';
import { PinoLoggerAdapter } from '@infrastructure/logging';
import type { PinoLogger } from 'nestjs-pino';

const contextWith = (context?: RequestContext): RequestContextPort => ({
    run: (_context, fn) => fn(),
    get: () => context,
});

describe('PinoLoggerAdapter', () => {
    const pino = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const sut = new PinoLoggerAdapter(pino as unknown as PinoLogger, contextWith());

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

    it('adds the trace of the request being handled to every line', () => {
        // Arrange
        const traced = new PinoLoggerAdapter(
            pino as unknown as PinoLogger,
            contextWith({ requestId: 'r-1', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }),
        );

        // Act
        traced.info('tickets.closed', { ticketId: 't-1' });

        // Assert
        expect(pino.info).toHaveBeenCalledWith(
            { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), ticketId: 't-1' },
            'tickets.closed',
        );
    });

    it('logs without a trace outside a request, instead of inventing one', () => {
        // Arrange: a cron job

        // Act
        sut.info('scheduler.job.finished', { job: 'tickets.closeStale' });

        // Assert
        expect(pino.info).toHaveBeenCalledWith(
            { job: 'tickets.closeStale' },
            'scheduler.job.finished',
        );
    });
});
