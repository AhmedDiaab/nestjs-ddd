import { DEPRECATION_METADATA } from '@interface/http/decorators';
import {
    Injectable,
    type CallHandler,
    type ExecutionContext,
    type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import type { DeprecationHeaders } from '../common/deprecation-headers.util';

/**
 * Backs `@Deprecated(...)`: sets `Deprecation`/`Sunset`/`Link` on the response for a decorated
 * route, then passes the handler's value through untouched.
 *
 * Registered in `interface.module.ts` between `MetricsInterceptor` and `ZodHttpInterceptor` —
 * it only sets headers before `next.handle()` runs, so running this early means the headers
 * survive a later rejection (a 400 from Zod, a 500 from the handler) instead of being skipped
 * because something downstream threw first.
 */
@Injectable()
export class DeprecationInterceptor implements NestInterceptor {
    constructor(private readonly reflector: Reflector) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const headers = this.reflector.getAllAndOverride<DeprecationHeaders | undefined>(
            DEPRECATION_METADATA,
            [context.getHandler(), context.getClass()],
        );

        if (headers) {
            const res = context.switchToHttp().getResponse<Response>();
            res.setHeader('Deprecation', headers.Deprecation);
            res.setHeader('Sunset', headers.Sunset);
            if (headers.Link) res.setHeader('Link', headers.Link);
        }

        return next.handle();
    }
}
