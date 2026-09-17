import { IS_PUBLIC } from '@interface/http/decorators';
import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

/**
 * Verifies the JWT of every request, except on handlers or controllers marked `@Public()`.
 *
 * Registered globally in `InterfaceModule`; applying it again with `@UseGuards(JwtGuard)`
 * is harmless (the strategy simply runs twice) and stays valid if the global
 * registration is removed.
 */
@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
    constructor(private readonly reflector: Reflector) {
        super();
    }

    canActivate(context: ExecutionContext) {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
            context.getHandler(),
            context.getClass(),
        ]);

        return isPublic ? true : super.canActivate(context);
    }
}
