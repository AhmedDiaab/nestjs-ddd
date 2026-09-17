import { Public } from '@interface/http/decorators';
import { Controller, Get } from '@nestjs/common';

/** One handler open, its neighbour protected. */
@Controller('e2e-auth/mixed')
export class MixedAuthController {
    @Public()
    @Get('open')
    open() {
        return { reached: true };
    }

    @Get('closed')
    closed() {
        return { reached: true };
    }
}
