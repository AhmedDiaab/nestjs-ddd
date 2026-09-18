import type { ConfigPort, DatabaseHealthPort, LoggerPort, ShutdownPort } from '@application/ports';
import {
    ConfigPortToken,
    DatabaseHealthPortToken,
    LoggerPortToken,
    ShutdownPortToken,
} from '@application/ports';
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
        @Inject(DatabaseHealthPortToken) private readonly databaseHealth: DatabaseHealthPort,
        @Inject(ConfigPortToken) private readonly config: ConfigPort,
        @Inject(ShutdownPortToken) private readonly shutdown: ShutdownPort,
        @Inject(LoggerPortToken) private readonly logger: LoggerPort,
    ) {}

    /**
     * Liveness: the process is up. No dependencies checked, and it stays `ok` while draining —
     * a liveness probe that fails during shutdown gets the process killed mid-request.
     */
    @Get()
    live() {
        return { status: 'ok' };
    }

    /**
     * Readiness: every implemented database source answers a ping. The body carries nothing
     * beyond `status`: which sources are down, on what dialect and why, is diagnostic detail
     * an anonymous caller has no business seeing. The same detail is one `GET
     * /v1/health/sources` away for anyone holding the `admin` role, and every failing source is
     * logged here at `warn` for anyone with the application log.
     */
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
        const sources = await this.databaseHealth.check(timeoutMs);
        const failing = sources.filter((s) => s.implemented && !s.ok);

        if (failing.length > 0) {
            this.logger.warn('health.ready.failed', { sources: failing });
            throw new ServiceUnavailableException({ message: 'Not ready', code: 'NOT_READY' });
        }
        return { status: 'ok' };
    }
}
