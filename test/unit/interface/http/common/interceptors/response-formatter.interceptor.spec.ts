import { BadRequestError } from '@application/errors';
import { ResponseFormatterInterceptor } from '@interface/http/common/interceptors/response-formatter.interceptor';
import {
    UnprocessableEntityException,
    type CallHandler,
    type ExecutionContext,
} from '@nestjs/common';
import { Result } from '@shared';
import { lastValueFrom, of } from 'rxjs';

describe('ResponseFormatterInterceptor test suite', () => {
    let sut: ResponseFormatterInterceptor;
    let body: Buffer | object = { raw: true };
    const handleMock = jest.fn(() => of(body));

    const req = {
        headers: {
            'x-skip-format': false,
        },
        url: '/',
        originalUrl: '/',
        id: 'req-1',
    };

    const res = {
        headersSent: false,
        body,
    };

    const next = {
        handle: handleMock,
    } as unknown as jest.Mocked<CallHandler>;

    const context = {
        switchToHttp: jest.fn().mockReturnValue({
            getRequest: jest.fn().mockReturnValue(req),
            getResponse: jest.fn().mockReturnValue(res),
        }),
    } as unknown as jest.Mocked<ExecutionContext>;

    beforeEach(() => {
        sut = new ResponseFormatterInterceptor();
    });

    afterEach(() => {
        jest.clearAllMocks();
        req.headers['x-skip-format'] = false;
        res.headersSent = false;
    });

    it('should skip when SKIP_FORMAT_HEADER = true', async () => {
        req.headers['x-skip-format'] = true;
        const result = await lastValueFrom(sut.intercept(context, next));

        expect(handleMock).toHaveBeenCalled();
        expect(result).toBe(body); // pass-through
    });

    it('should skip if headers already sent', async () => {
        res.headersSent = true;
        const result = await lastValueFrom(sut.intercept(context, next));
        expect(handleMock).toHaveBeenCalled();
        expect(result).toBe(body); // pass-through
    });

    it('should return payload as is if it is buffer of similar type', async () => {
        body = Buffer.from([1, 2, 3]) as unknown as Buffer;
        const result = await lastValueFrom(sut.intercept(context, next));
        expect(handleMock).toHaveBeenCalled();
        expect(result).toBe(body); // pass-through
    });

    describe('handling response envelope', () => {
        const timestamp = 1777913150788;
        const date = new Date(timestamp).toISOString();

        beforeEach(() => {
            jest.spyOn(Date.prototype, 'toISOString').mockReturnValueOnce(date);
            body = {
                raw: true,
            };
        });

        it('should forward response body if payload is envelope', async () => {
            body = Object.assign(body, {
                success: true,
                meta: {
                    test: true,
                },
            });
            const result = await lastValueFrom(sut.intercept(context, next));
            expect(handleMock).toHaveBeenCalled();
            expect(result).toEqual({
                ...body,
                meta: {
                    ...(body as Record<'meta', object>).meta,
                    path: '/',
                    requestId: 'req-1',
                    timestamp: date,
                },
            });
        });

        it('should handle success result like body', async () => {
            const okResut = Result.ok(body);
            handleMock.mockReturnValueOnce(of(okResut));

            const result = await lastValueFrom(sut.intercept(context, next));

            expect(handleMock).toHaveBeenCalled();
            expect(result).toEqual({
                success: true,
                data: { raw: true },
                meta: {
                    timestamp: date,
                    path: '/',
                    requestId: 'req-1',
                },
            });
        });

        it('should rethrow presentable Result errors so the filter sets the HTTP status', async () => {
            const error = new BadRequestError('test error');
            handleMock.mockReturnValueOnce(of(Result.err(error)));

            await expect(lastValueFrom(sut.intercept(context, next))).rejects.toBe(error);
        });

        it('should turn non-presentable Result errors into 422 with the error code', async () => {
            handleMock.mockReturnValueOnce(of(Result.err('database_error')));

            const thrown: unknown = await lastValueFrom(sut.intercept(context, next)).catch(
                (e: unknown) => e,
            );

            expect(thrown).toBeInstanceOf(UnprocessableEntityException);
            expect((thrown as UnprocessableEntityException).getResponse()).toMatchObject({
                code: 'database_error',
            });
        });

        it('should handle success responses', async () => {
            const result = await lastValueFrom(sut.intercept(context, next));
            expect(handleMock).toHaveBeenCalled();
            expect(result).toEqual({
                success: true,
                data: { raw: true },
                meta: {
                    timestamp: date,
                    path: '/',
                    requestId: 'req-1',
                },
            });
        });
    });
});
