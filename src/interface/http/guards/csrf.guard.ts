import { ForbiddenError } from '@application/errors';
import { ConfigPortToken, type ConfigPort } from '@application/ports';
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { ProblemLike } from '@shared';
import type { Request } from 'express';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class CsrfRejectedError extends ForbiddenError {
    constructor() {
        super('Cross-site request rejected');
    }

    override toProblem(): ProblemLike {
        return { ...super.toProblem(), code: 'CSRF_REJECTED' };
    }
}

function originOf(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
        return new URL(url).origin;
    } catch {
        return undefined;
    }
}

/**
 * CSRF defence for cookie-based JWT auth (browsers attach the cookie to cross-site requests).
 * State-changing requests that carry the auth cookie must come from the API's own origin or a
 * trusted one. Not affected: safe methods, requests without the cookie, and requests with an
 * `Authorization` header (a cross-site page can't add one without passing CORS preflight).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
    private readonly enabled: boolean;
    private readonly cookieName: string;
    private readonly trustedOrigins: ReadonlySet<string>;

    constructor(@Inject(ConfigPortToken) config: ConfigPort) {
        this.enabled = config.get('http.csrfEnabled');
        this.cookieName = config.get('jwt.cookieName');
        this.trustedOrigins = new Set(
            config.get('http.csrfTrustedOrigins') ?? config.get('http.corsOrigins'),
        );
    }

    canActivate(context: ExecutionContext): boolean {
        if (!this.enabled) return true;

        const req = context.switchToHttp().getRequest<Request>();
        if (!STATE_CHANGING.has(req.method)) return true;
        if (!req.cookies?.[this.cookieName]) return true;
        if (req.headers.authorization) return true;

        const fetchSite = req.get('sec-fetch-site');
        if (fetchSite === 'same-origin' || fetchSite === 'none') return true;

        const origin = req.get('origin') ?? originOf(req.get('referer'));
        const ownOrigin = `${req.protocol}://${req.get('host')}`;
        if (origin && (origin === ownOrigin || this.trustedOrigins.has(origin))) return true;

        throw new CsrfRejectedError();
    }
}
