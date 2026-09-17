import type { ConfigPort, LoggerPort } from '@application/ports';
import { DatabaseExecutionError } from '@infrastructure/database/errors';
import { ErrorPresenter } from '@interface/http/error-presenter';
import { GlobalExceptionFilter } from '@interface/http/global-exception.filter';
import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';

jest.mock('dotenv-flow/config', () => undefined);

const createConfigStub = (showStackTraces: boolean): ConfigPort => ({
    get: <T>(key: string) => {
        if (key === 'logging.showStackTraces') return showStackTraces as T;
        return undefined;
    },
    all: () => ({}),
    isDevelopment: () => false,
    isProduction: () => false,
});

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
        const config = createConfigStub(true);
        const { logger, warn } = createLoggerStub();
        const presenter = new ErrorPresenter();
        const filter = new GlobalExceptionFilter(presenter, config, logger);
        const hostBundle = createHost();

        const exception = new BadRequestException({ message: 'Missing username', code: 'INVALID' });
        filter.catch(exception, hostBundle.host);

        expect(hostBundle.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
        const payload = hostBundle.json.mock.calls[0][0] as {
            success: boolean;
            error: { message: string; code?: string };
            meta: { path: string; requestId?: string };
        };
        expect(payload).toMatchObject({
            success: false,
            error: { message: 'Missing username', code: 'INVALID' },
            meta: { path: '/users/countries', requestId: 'req-1' },
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('400'), expect.any(Object));
    });

    it('delegates unknown errors to ErrorPresenter and logs errors for 500s', () => {
        const config = createConfigStub(true);
        const { logger, error } = createLoggerStub();
        const presenter = new ErrorPresenter();
        const filter = new GlobalExceptionFilter(presenter, config, logger);
        const hostBundle = createHost();
        hostBundle.req.id = undefined;

        filter.catch(new Error('boom'), hostBundle.host);

        expect(hostBundle.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
        const payload = hostBundle.json.mock.calls[0][0] as {
            success: boolean;
            error: { message: string };
            meta: { requestId?: string };
        };
        expect(payload).toMatchObject({
            success: false,
            error: { message: 'Unexpected error' },
            meta: { requestId: 'no-id' },
        });
        expect(error).toHaveBeenCalledWith(expect.stringContaining('500'), expect.any(Object));
    });

    it('logs 5xx even when stack traces are disabled, without the stack', () => {
        const config = createConfigStub(false);
        const { logger, error } = createLoggerStub();
        const filter = new GlobalExceptionFilter(new ErrorPresenter(), config, logger);
        const hostBundle = createHost();

        filter.catch(new Error('boom'), hostBundle.host);

        expect(error).toHaveBeenCalledWith(
            expect.stringContaining('500'),
            expect.objectContaining({ stack: undefined }),
        );
    });

    it('never returns internal error details to the client', () => {
        const { logger } = createLoggerStub();
        const filter = new GlobalExceptionFilter(
            new ErrorPresenter(),
            createConfigStub(false),
            logger,
        );
        const hostBundle = createHost();

        filter.catch(
            new DatabaseExecutionError(
                'main',
                'site.delete',
                new Error('ORA-20101 secret'),
                'ORA-20101',
            ),
            hostBundle.host,
        );

        const payload = JSON.stringify(hostBundle.json.mock.calls[0][0]);
        expect(payload).not.toContain('ORA-20101');
        expect(payload).not.toContain('secret');
    });

    it('maps exposed body-parser errors to their 4xx status instead of 500', () => {
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

        filter.catch(tooLarge, hostBundle.host);

        expect(hostBundle.status).toHaveBeenCalledWith(413);
        expect(hostBundle.json.mock.calls[0][0]).toMatchObject({
            success: false,
            error: { message: 'request entity too large', code: 'entity.too.large' },
        });
    });
});
