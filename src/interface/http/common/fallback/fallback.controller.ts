import { NotFoundError } from '@application/errors';
import { All, Controller, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

@Controller()
@ApiExcludeController()
export class FallbackController {
    @All('*all')
    handleAll(@Req() req: Request): never {
        throw new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`);
    }
}
