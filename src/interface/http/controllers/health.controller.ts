import type { ConfigPort } from '@application/ports';
import { ConfigPortToken } from '@application/ports';
import { ConnectionProviderToken } from '@infrastructure/database/connection';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import {
    Controller,
    Get,
    Inject,
    ServiceUnavailableException,
    VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

@ApiTags('health')
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
    constructor(
        @Inject(ConnectionProviderToken) private readonly db: ConnectionProvider,
        @Inject(ConfigPortToken) private readonly config: ConfigPort,
    ) {}

    /** Liveness: process is up. No dependencies checked. */
    @Get()
    live() {
        return { status: 'ok' };
    }

    /** Readiness: every implemented database source answers a ping. */
    @Get('ready')
    async ready() {
        const timeoutMs = this.config.get('database.health.timeoutMs') ?? 3000;
        const hideErrors = this.config.isProduction();

        const sources = (await this.db.health(timeoutMs)).map((source) => ({
            ...source,
            error: hideErrors ? undefined : source.error,
        }));
        const ok = sources.filter((s) => s.implemented).every((s) => s.ok);

        if (!ok) {
            throw new ServiceUnavailableException({
                message: 'Not ready',
                code: 'NOT_READY',
                details: sources,
            });
        }
        return { status: 'ok', sources };
    }
}
