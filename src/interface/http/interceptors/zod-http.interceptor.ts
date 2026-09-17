import {
    BadRequestException,
    Injectable,
    type CallHandler,
    type ExecutionContext,
    type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { ZodType } from 'zod';
import { formatZodError } from '../common/format-zod-error.util';
import { ZOD_HTTP_SCHEMA, type ZodHttpSchema } from '../decorators/zod-http.decorator';

type Part = 'body' | 'query' | 'params' | 'headers';

@Injectable()
export class ZodHttpInterceptor implements NestInterceptor {
    constructor(private readonly reflector: Reflector) {}

    /**
     * Every validated part is stored on `req.validated[part]` (read it with `@Validated('query')`).
     * `body` and `params` are also replaced in place. `query` is not: Express 5 exposes it as a
     * getter, so assigning it throws. `headers` is not replaced either, so unlisted headers survive.
     */
    private store(req: Request, part: Part, value: unknown): void {
        req.validated = { ...req.validated, [part]: value };
        if (part === 'body') req.body = value;
        if (part === 'params') req.params = value as Request['params'];
    }

    async intercept(context: ExecutionContext, next: CallHandler) {
        const schema = this.reflector.getAllAndOverride<ZodHttpSchema | undefined>(
            ZOD_HTTP_SCHEMA,
            [context.getHandler(), context.getClass()],
        );

        if (!schema) return next.handle();

        const req = context.switchToHttp().getRequest<Request>();
        const useAsync = !!schema.async;

        const validate = async (part: Part, zod: ZodType) => {
            const source: unknown = req[part];
            const parsed = useAsync ? await zod.safeParseAsync(source) : zod.safeParse(source);
            if (!parsed.success) {
                throw new BadRequestException(formatZodError(parsed.error, part));
            }
            this.store(req, part, parsed.data);
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
