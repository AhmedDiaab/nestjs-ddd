import { NotFoundError } from '@application/errors/not-found-error';
import { All, Controller, Req } from '@nestjs/common';
import type { Request } from 'express';

@Controller()
export class FallbackController {
    @All('*')
    handleAll(@Req() req: Request): never {
        throw new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`);
    }
}
