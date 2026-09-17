import { Roles } from '@interface/http/decorators';
import { Controller, Get } from '@nestjs/common';

/** Role required by the route; the token has to carry it. */
@Controller('e2e-auth/roles')
export class RolesAuthController {
    @Roles('admin')
    @Get('admin-only')
    adminOnly() {
        return { reached: true };
    }

    @Get('any-user')
    anyUser() {
        return { reached: true };
    }
}
