import { NotFoundError } from '@application/errors';
import { Public } from '@interface/http/decorators';
import { All, Controller, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

@Controller()
@Public() // unknown paths answer 404, not 401
@ApiExcludeController()
export class FallbackController {
    @All('*all')
    handleAll(@Req() req: Request): never {
        throw new NotFoundError(`Cannot ${req.method} ${req.originalUrl}`);
    }
}
