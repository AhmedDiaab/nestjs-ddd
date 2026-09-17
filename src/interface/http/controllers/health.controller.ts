import type { ConfigPort, ShutdownPort } from '@application/ports';
import { ConfigPortToken, ShutdownPortToken } from '@application/ports';
import { ConnectionProviderToken } from '@infrastructure/database/connection';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { Public } from '@interface/http/decorators';
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
@Public() // monitors and load balancers poll these without a token
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
    constructor(
        @Inject(ConnectionProviderToken) private readonly db: ConnectionProvider,
        @Inject(ConfigPortToken) private readonly config: ConfigPort,
        @Inject(ShutdownPortToken) private readonly shutdown: ShutdownPort,
    ) {}

    /**
     * Liveness: the process is up. No dependencies checked, and it stays `ok` while draining —
     * a liveness probe that fails during shutdown gets the process killed mid-request.
     */
    @Get()
    live() {
        return { status: 'ok' };
    }

    /** Readiness: every implemented database source answers a ping. */
    @Get('ready')
    async ready() {
        // draining: tell the load balancer to stop routing here before the port closes
        if (this.shutdown.isShuttingDown()) {
            throw new ServiceUnavailableException({
                message: 'Shutting down',
                code: 'SHUTTING_DOWN',
            });
        }

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
