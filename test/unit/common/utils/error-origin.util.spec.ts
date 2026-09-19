import { errorOrigin, resolveErrorOrigin } from '@common/utils';

/** Builds a stack string by hand: real driver stacks aren't worth reproducing to test parsing. */
const stackOf = (...frames: string[]): string =>
    ['Error', ...frames.map((f) => `    at ${f}`)].join('\n');

const DRIVER_FRAMES = [
    'Connection.execute (/repo/node_modules/oracledb/lib/connection.js:512:23)',
    'processTicksAndRejections (node:internal/process/task_queues:95:5)',
];

describe('errorOrigin', () => {
    it('returns the frame of a plain throw from our own code', () => {
        // Arrange
        const error = new Error('boom');
        error.stack = stackOf(
            'TicketService.close (/repo/src/domain/tickets/close.ts:42:11)',
            'process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
        );

        // Act
        const origin = errorOrigin(error);

        // Assert
        expect(origin).toBe('src/domain/tickets/close.ts:42 (TicketService.close)');
    });

    it('skips every dependency frame at the top and finds our frame further down', () => {
        // Arrange
        const error = new Error('ORA-12345: fake driver failure');
        error.stack = stackOf(
            ...DRIVER_FRAMES,
            'OracleTicketsDao.findById (/repo/src/infrastructure/database/dao/oracle-tickets.dao.ts:77:9)',
            'Object.<anonymous> (/repo/node_modules/jest-circus/build/run.js:100:3)',
        );

        // Act
        const origin = errorOrigin(error);

        // Assert
        expect(origin).toBe(
            'src/infrastructure/database/dao/oracle-tickets.dao.ts:77 (OracleTicketsDao.findById)',
        );
    });

    it('returns undefined when every frame in the chain is a dependency frame', () => {
        // Arrange
        const error = new Error('boom');
        error.stack = stackOf(...DRIVER_FRAMES);

        // Act
        const origin = errorOrigin(error);

        // Assert
        expect(origin).toBeUndefined();
    });

    it('returns undefined when the stack is missing', () => {
        // Arrange
        const error = new Error('boom');
        error.stack = undefined;

        // Act
        const origin = errorOrigin(error);

        // Assert
        expect(origin).toBeUndefined();
    });

    it('returns undefined for a non-Error string throw', () => {
        // Arrange
        const thrown = 'just a string';

        // Act
        const origin = errorOrigin(thrown);

        // Assert
        expect(origin).toBeUndefined();
    });

    it('returns undefined for a non-Error plain object throw', () => {
        // Arrange
        const thrown = { message: 'boom' };

        // Act
        const origin = errorOrigin(thrown);

        // Assert
        expect(origin).toBeUndefined();
    });

    it('handles a frame with no function name (no parentheses)', () => {
        // Arrange
        const error = new Error('boom');
        error.stack = stackOf('/repo/src/domain/tickets/close.ts:12:3');

        // Act
        const origin = errorOrigin(error);

        // Assert
        expect(origin).toBe('src/domain/tickets/close.ts:12');
    });

    it('reads a /dist/ path the same way as a /src/ path', () => {
        // Arrange
        const error = new Error('boom');
        error.stack = stackOf('TicketService.close (/repo/dist/domain/tickets/close.js:42:11)');

        // Act
        const origin = errorOrigin(error);

        // Assert
        expect(origin).toBe('dist/domain/tickets/close.js:42 (TicketService.close)');
    });

    it('names the spec line for an error thrown inside a test', () => {
        // Arrange
        const error = new Error('boom');
        error.stack = stackOf('Object.<anonymous> (/repo/test/e2e/http-errors.e2e-spec.ts:46:15)');

        // Act
        const origin = errorOrigin(error);

        // Assert
        expect(origin).toBe('test/e2e/http-errors.e2e-spec.ts:46 (Object.<anonymous>)');
    });

    it('prefers the application frame over the spec frame that called it', () => {
        // Arrange
        const error = new Error('boom');
        error.stack = stackOf(
            'TicketService.close (/repo/src/domain/tickets/close.ts:42:11)',
            'Object.<anonymous> (/repo/test/unit/domain/close.spec.ts:10:5)',
        );

        // Act
        const origin = errorOrigin(error);

        // Assert
        expect(origin).toBe('src/domain/tickets/close.ts:42 (TicketService.close)');
    });
});

describe('resolveErrorOrigin', () => {
    it('reports the wrapper site as origin and the inner driver frame as causeOrigin', () => {
        // Arrange
        const driverError = new Error('ORA-12345: fake driver failure');
        driverError.stack = stackOf(
            ...DRIVER_FRAMES,
            'OracleTicketsDao.findById (/repo/src/infrastructure/database/dao/oracle-tickets.dao.ts:77:9)',
        );
        const wrapper = new Error('DB execution failed for "main"') as Error & { cause?: unknown };
        wrapper.stack = stackOf(
            'OracleTicketsDao.findById (/repo/src/infrastructure/database/dao/oracle-tickets.dao.ts:80:15)',
            'process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
        );
        wrapper.cause = driverError;

        // Act
        const result = resolveErrorOrigin(wrapper);

        // Assert
        expect(result).toEqual({
            origin: 'src/infrastructure/database/dao/oracle-tickets.dao.ts:80 (OracleTicketsDao.findById)',
            causeOrigin:
                'src/infrastructure/database/dao/oracle-tickets.dao.ts:77 (OracleTicketsDao.findById)',
        });
    });

    it('omits causeOrigin when the cause has no app frame of its own', () => {
        // Arrange
        const driverError = new Error('ORA-12345');
        driverError.stack = stackOf(...DRIVER_FRAMES);
        const wrapper = new Error('DB execution failed') as Error & { cause?: unknown };
        wrapper.stack = stackOf(
            'OracleTicketsDao.findById (/repo/src/infrastructure/database/dao/oracle-tickets.dao.ts:80:15)',
        );
        wrapper.cause = driverError;

        // Act
        const result = resolveErrorOrigin(wrapper);

        // Assert
        expect(result).toEqual({
            origin: 'src/infrastructure/database/dao/oracle-tickets.dao.ts:80 (OracleTicketsDao.findById)',
        });
    });

    it('returns an empty object when the entire chain is dependency frames', () => {
        // Arrange
        const cause = new Error('cause');
        cause.stack = stackOf(...DRIVER_FRAMES);
        const outer = new Error('outer') as Error & { cause?: unknown };
        outer.stack = stackOf(...DRIVER_FRAMES);
        outer.cause = cause;

        // Act
        const result = resolveErrorOrigin(outer);

        // Assert
        expect(result).toEqual({});
    });

    it('terminates on a cyclic cause chain instead of looping forever', () => {
        // Arrange
        const a = new Error('a') as Error & { cause?: unknown };
        const b = new Error('b') as Error & { cause?: unknown };
        a.stack = stackOf(...DRIVER_FRAMES);
        b.stack = stackOf(...DRIVER_FRAMES);
        a.cause = b;
        b.cause = a;

        // Act
        const result = resolveErrorOrigin(a);

        // Assert
        expect(result).toEqual({});
    });
});
