import { Controller, Get } from '@nestjs/common';

/** Says nothing about authentication: the global guard must protect it. */
@Controller('e2e-auth/silent')
export class SilentAuthController {
    @Get()
    read() {
        return { reached: true };
    }
}
