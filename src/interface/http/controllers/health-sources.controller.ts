import {
    ConfigPortToken,
    DatabaseHealthPortToken,
    type ConfigPort,
    type DatabaseHealthPort,
} from '@application/ports';
import { Roles } from '@interface/http/decorators';
import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { BEARER_SECURITY, COOKIE_SECURITY } from '../swagger/swagger.constants';

/**
 * The per-source detail `/health/ready` used to publish to anyone who could reach the port:
 * which sources are configured, their dialect, latency and error text. Behind a token and the
 * `admin` role now — no `@Public()`, so the global `JwtGuard` applies.
 */
@ApiTags('health')
@ApiBearerAuth(BEARER_SECURITY)
@ApiCookieAuth(COOKIE_SECURITY)
@Roles('admin')
@Controller({ path: 'health/sources', version: '1' })
export class HealthSourcesController {
    constructor(
        @Inject(DatabaseHealthPortToken) private readonly databaseHealth: DatabaseHealthPort,
        @Inject(ConfigPortToken) private readonly config: ConfigPort,
    ) {}

    @Get()
    async list() {
        const timeoutMs = this.config.get('database.health.timeoutMs') ?? 3000;
        const sources = await this.databaseHealth.check(timeoutMs);
        return { sources };
    }
}
