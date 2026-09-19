import type { ConfigPort, LoggerPort } from '@application/ports';
import { DatabaseExecutionError } from '@infrastructure/database/errors';
import { ErrorPresenter } from '@interface/http/error-presenter';
import { GlobalExceptionFilter } from '@interface/http/global-exception.filter';
import { BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

jest.mock('dotenv-flow/config', () => undefined);

const createConfigStub = (showStackTraces: boolean): ConfigPort =>
    ({
        get: (key: string) => (key === 'logging.showStackTraces' ? showStackTraces : undefined),
        all: () => ({}),
        isDevelopment: () => false,
        isProduction: () => false,
    }) as unknown as ConfigPort;

const createLoggerStub = () => {
    const debugMock = jest.fn<ReturnType<LoggerPort['debug']>, Parameters<LoggerPort['debug']>>();
    const infoMock = jest.fn<ReturnType<LoggerPort['info']>, Parameters<LoggerPort['info']>>();
    const warnMock = jest.fn<ReturnType<LoggerPort['warn']>, Parameters<LoggerPort['warn']>>();
    const errorMock = jest.fn<ReturnType<LoggerPort['error']>, Parameters<LoggerPort['error']>>();
    const logger: LoggerPort = {
        debug: (message, meta) => {
            debugMock(message, meta);
        },
        info: (message, meta) => {
            infoMock(message, meta);
        },
        warn: (message, meta) => {
            warnMock(message, meta);
        },
        error: (message, meta) => {
            errorMock(message, meta);
        },
    };
    return { logger, warn: warnMock, error: errorMock };
};

type HostBundle = {
    host: ArgumentsHost;
    json: jest.Mock<void, [unknown]>;
    status: jest.Mock<{ json: jest.Mock<void, [unknown]> }, [number]>;
    req: {
        method: string;
        url: string;
        originalUrl: string;
        id?: string;
    };
};

const createHost = (): HostBundle => {
    const json = jest.fn<void, [unknown]>();
    const status = jest.fn<{ json: typeof json }, [number]>(() => ({ json }));
    const req = {
        method: 'GET',
        url: '/users/countries',
        originalUrl: '/users/countries',
        id: 'req-1' as string | undefined,
    };
    const res = { status };
    const host = {
        switchToHttp: () => ({
            getRequest: () => req,
            getResponse: () => res,
        }),
    } as unknown as ArgumentsHost;

    return { host, status, json, req };
};

describe('GlobalExceptionFilter (behavioural)', () => {
    it('wraps HttpExceptions in the envelope and logs 4xx as warnings', () => {
        // Arrange
        const { logger, warn } = createLoggerStub();
        const filter = new GlobalExceptionFilter(
            new ErrorPresenter(),
            createConfigStub(true),
            logger,
        );
        const hostBundle = createHost();
        const exception = new BadRequestException({ message: 'Missing username', code: 'INVALID' });

        // Act
        filter.catch(exception, hostBundle.host);

        // Assert
        expect(hostBundle.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        expect(hostBundle.json.mock.calls[0][0]).toMatchObject({
            success: false,
            error: { message: 'Missing username', code: 'INVALID' },
            meta: { path: '/users/countries', requestId: 'req-1' },
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('400'), expect.any(Object));
    });

    it('delegates unknown errors to ErrorPresenter and logs errors for 500s', () => {
        // Arrange
        const { logger, error } = createLoggerStub();
        const filter = new GlobalExceptionFilter(
            new ErrorPresenter(),
            createConfigStub(true),
            logger,
        );
        const hostBundle = createHost();
        hostBundle.req.id = undefined;

        // Act
        filter.catch(new Error('boom'), hostBundle.host);

        // Assert
        expect(hostBundle.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
        expect(hostBundle.json.mock.calls[0][0]).toMatchObject({
            success: false,
            error: { message: 'Unexpected error' },
            meta: { requestId: 'no-id' },
        });
        expect(error).toHaveBeenCalledWith(expect.stringContaining('500'), expect.any(Object));
    });

    it('logs 5xx even when stack traces are disabled, without the stack', () => {
        // Arrange
        const { logger, error } = createLoggerStub();
        const filter = new GlobalExceptionFilter(
            new ErrorPresenter(),
            createConfigStub(false),
            logger,
        );
        const hostBundle = createHost();

        // Act
        filter.catch(new Error('boom'), hostBundle.host);

        // Assert
        expect(error).toHaveBeenCalledWith(
            expect.stringContaining('500'),
            expect.objectContaining({ stack: undefined }),
        );
    });

    it('adds the error origin to the log meta', () => {
        // Arrange
        const { logger, error } = createLoggerStub();
        const filter = new GlobalExceptionFilter(
            new ErrorPresenter(),
            createConfigStub(false),
            logger,
        );
        const hostBundle = createHost();
        const exception = new Error('boom');
        exception.stack =
            'Error: boom\n    at TicketService.close (/repo/src/domain/tickets/close.ts:42:11)';

        // Act
        filter.catch(exception, hostBundle.host);

        // Assert
        expect(error).toHaveBeenCalledWith(
            expect.stringContaining('500'),
            expect.objectContaining({
                origin: 'src/domain/tickets/close.ts:42 (TicketService.close)',
            }),
        );
    });

    it('adds the cause origin to the log meta when it differs from the origin', () => {
        // Arrange
        const { logger, error } = createLoggerStub();
        const filter = new GlobalExceptionFilter(
            new ErrorPresenter(),
            createConfigStub(false),
            logger,
        );
        const hostBundle = createHost();
        const driverError = new Error('ORA-12345');
        driverError.stack =
            'Error: ORA-12345\n    at Connection.execute (/repo/node_modules/oracledb/lib/connection.js:512:23)\n    at OracleTicketsDao.findById (/repo/src/infrastructure/database/dao/oracle-tickets.dao.ts:77:9)';
        const exception = new DatabaseExecutionError(
            'main',
            'tickets.findById',
            driverError,
            'ORA-20101',
        );
        exception.stack =
            'Error: DB execution failed\n    at OracleTicketsDao.findById (/repo/src/infrastructure/database/dao/oracle-tickets.dao.ts:80:15)';

        // Act
        filter.catch(exception, hostBundle.host);

        // Assert
        expect(error).toHaveBeenCalledWith(
            expect.stringContaining('500'),
            expect.objectContaining({
                origin: 'src/infrastructure/database/dao/oracle-tickets.dao.ts:80 (OracleTicketsDao.findById)',
                causeOrigin:
                    'src/infrastructure/database/dao/oracle-tickets.dao.ts:77 (OracleTicketsDao.findById)',
            }),
        );
    });

    it('never returns internal error details to the client', () => {
        // Arrange
        const { logger } = createLoggerStub();
        const filter = new GlobalExceptionFilter(
            new ErrorPresenter(),
            createConfigStub(false),
            logger,
        );
        const hostBundle = createHost();
        const exception = new DatabaseExecutionError(
            'main',
            'site.delete',
            new Error('ORA-20101 secret'),
            'ORA-20101',
        );

        // Act
        filter.catch(exception, hostBundle.host);

        // Assert
        const payload = JSON.stringify(hostBundle.json.mock.calls[0][0]);
        expect(payload).not.toContain('ORA-20101');
        expect(payload).not.toContain('secret');
    });

    it('unwraps a plain string HttpException response into the message', () => {
        // Arrange
        const { logger } = createLoggerStub();
        const filter = new GlobalExceptionFilter(
            new ErrorPresenter(),
            createConfigStub(false),
            logger,
        );
        const hostBundle = createHost();
        const exception = new HttpException('Plain text error', HttpStatus.FORBIDDEN);

        // Act
        filter.catch(exception, hostBundle.host);

        // Assert
        expect(hostBundle.status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
        expect(hostBundle.json.mock.calls[0][0]).toMatchObject({
            success: false,
            error: { message: 'Plain text error' },
        });
    });

    it('joins a list of messages from a non-record response', () => {
        // Arrange
        const { logger } = createLoggerStub();
        const filter = new GlobalExceptionFilter(
            new ErrorPresenter(),
            createConfigStub(false),
            logger,
        );
        const hostBundle = createHost();
        const exception = new HttpException(['a', 'b'], HttpStatus.BAD_REQUEST);

        // Act
        filter.catch(exception, hostBundle.host);

        // Assert
        expect(hostBundle.json.mock.calls[0][0]).toMatchObject({
            success: false,
            error: { message: 'a; b' },
        });
    });

    it('falls back to the status name instead of stringifying a response with no message in it', () => {
        // Arrange
        const { logger } = createLoggerStub();
        const filter = new GlobalExceptionFilter(
            new ErrorPresenter(),
            createConfigStub(false),
            logger,
        );
        const hostBundle = createHost();
        const exception = new HttpException(42 as unknown as string, HttpStatus.BAD_REQUEST);

        // Act
        filter.catch(exception, hostBundle.host);

        // Assert
        const payload = JSON.stringify(hostBundle.json.mock.calls[0][0]);
        expect(payload).not.toContain('[object Object]');
        expect(hostBundle.json.mock.calls[0][0]).toMatchObject({
            success: false,
            error: { message: HttpStatus[HttpStatus.BAD_REQUEST] },
        });
    });

    it('maps exposed body-parser errors to their 4xx status instead of 500', () => {
        // Arrange
        const { logger } = createLoggerStub();
        const filter = new GlobalExceptionFilter(
            new ErrorPresenter(),
            createConfigStub(false),
            logger,
        );
        const hostBundle = createHost();
        const tooLarge = Object.assign(new Error('request entity too large'), {
            status: 413,
            expose: true,
            type: 'entity.too.large',
        });

        // Act
        filter.catch(tooLarge, hostBundle.host);

        // Assert
        expect(hostBundle.status).toHaveBeenCalledWith(413);
        expect(hostBundle.json.mock.calls[0][0]).toMatchObject({
            success: false,
            error: { message: 'request entity too large', code: 'entity.too.large' },
        });
    });
});
