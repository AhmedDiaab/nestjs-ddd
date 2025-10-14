import type { IncomingHttpHeaders } from 'node:http';
import {
    BadRequestException,
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request as ExpressRequest } from 'express';
import { ZodError, ZodType } from 'zod';
import { ZOD_HTTP_SCHEMA, ZodHttpSchema } from '../decorators/zod-http.decorator';

type Part = 'body' | 'query' | 'params' | 'headers';

// IMPORTANT: replace, don't intersect — so we can assign validated values back.
type ValidatedRequest = Omit<ExpressRequest, 'body' | 'query' | 'params' | 'headers'> & {
    body: unknown;
    query: unknown;
    params: unknown;
    headers: IncomingHttpHeaders;
};

@Injectable()
export class ZodHttpInterceptor implements NestInterceptor {
    constructor(private readonly reflector: Reflector) {}

    private getPart(req: ValidatedRequest, part: Part): unknown {
        switch (part) {
            case 'body':
                return req.body;
            case 'query':
                return req.query;
            case 'params':
                return req.params;
            case 'headers':
                return req.headers;
        }
    }

    private setPart(req: ValidatedRequest, part: Part, value: unknown): void {
        switch (part) {
            case 'body':
                req.body = value;
                break;
            case 'query':
                req.query = value;
                break;
            case 'params':
                req.params = value;
                break;
            case 'headers':
                req.headers = value as IncomingHttpHeaders;
                break;
        }
    }

    async intercept(context: ExecutionContext, next: CallHandler) {
        const handler = context.getHandler();
        const cls = context.getClass();

        const schema = this.reflector.getAllAndOverride<ZodHttpSchema>(ZOD_HTTP_SCHEMA, [
            handler,
            cls,
        ]);

        if (!schema) return next.handle();

        const http = context.switchToHttp();
        const req = http.getRequest<ValidatedRequest>();

        const useAsync = !!schema.async;

        const validate = async (part: Part, zod?: ZodType) => {
            if (!zod) return;
            const source: unknown = this.getPart(req, part);
            const parsed = useAsync ? await zod.safeParseAsync(source) : zod.safeParse(source);
            if (!parsed.success) {
                throw new BadRequestException(formatZodError(parsed.error, part));
            }
            this.setPart(req, part, parsed.data);
        };

        const parts: ReadonlyArray<[Part, ZodType | undefined]> = [
            ['body', schema.body],
            ['query', schema.query],
            ['params', schema.params],
            ['headers', schema.headers],
        ];

        // TS-friendly type guard (can’t refer to a destructured binding in predicate)
        const isSchema = (e: [Part, ZodType | undefined]): e is [Part, ZodType] => !!e[1];

        await Promise.all(parts.filter(isSchema).map(([part, s]) => validate(part, s)));

        return next.handle();
    }
}

function formatZodError(error: ZodError, part: string) {
    const details = error.issues.map((i) => {
        const path = i.path.length ? `${part}.${i.path.join('.')}` : part;
        return `${path}: ${i.message}`;
    });
    return { message: 'Validation failed', details };
}
