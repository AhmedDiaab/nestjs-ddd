import { Public } from '@interface/http/decorators';
import { Controller, Get } from '@nestjs/common';

/** Opened at controller level. */
@Public()
@Controller('e2e-auth/open')
export class OpenAuthController {
    @Get()
    read() {
        return { reached: true };
    }
}
