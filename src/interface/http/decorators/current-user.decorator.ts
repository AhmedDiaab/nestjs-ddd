import type { JWTPayload } from '@domain/auth';
import type { ExecutionContext } from '@nestjs/common';
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export const CurrentUser = createParamDecorator(
    (data: keyof JWTPayload | undefined, ctx: ExecutionContext) => {
        const req: Request = ctx.switchToHttp().getRequest();
        return data ? req.user?.[data] : req.user;
    },
);
