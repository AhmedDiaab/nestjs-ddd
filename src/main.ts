import cluster from 'node:cluster';
import type { Server as HttpServer } from 'node:http';
import type { ConfigPort, LoggerPort, ShutdownPort } from '@application/ports';
import { ConfigPortToken, LoggerPortToken, ShutdownPortToken } from '@application/ports';
import { startPrimary } from '@infrastructure/cluster';
import { EnvConfigAdapter, InvalidConfigError, loadConfig } from '@infrastructure/config';
import { runGracefulShutdown } from '@infrastructure/lifecycle';
import { PinoProcessLogger } from '@infrastructure/logging';
import { loadTlsOptions } from '@infrastructure/tls';
import { setupSwagger } from '@interface/http/swagger';
import { JobScheduler } from '@interface/scheduler';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
    // `httpsOptions` (and, in cluster mode, the primary's config and logger) must be known
    // before Nest — and DI — exist, so this one read happens first. `loadConfig()` is pure
    // (env → Zod, no side effects) and is the same function `ConfigModule`'s `EnvConfigAdapter`
    // calls; every other read below goes through the injected `ConfigPort`.
    const bootstrapConfig = loadConfig();
    const configPort = new EnvConfigAdapter(bootstrapConfig);
    const httpsOptions = loadTlsOptions(configPort);

    // The primary never builds a Nest application: no database pools, no HTTP server, no
    // Swagger — see decision 0012. Workers (`cluster.isWorker`) and the single-process default
    // (`cluster.enabled` false) both fall through to the same bootstrap as always.
    if (bootstrapConfig.cluster.enabled && cluster.isPrimary) {
        startPrimary({
            clusterApi: cluster,
            config: bootstrapConfig,
            logger: new PinoProcessLogger(configPort),
        });
        return;
    }

    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        ...(httpsOptions ? { httpsOptions } : {}),
        bufferLogs: true,
        bodyParser: false, // configured below with limits from config
        rawBody: true, // req.rawBody, for IdempotencyInterceptor's fingerprint
    });

    // use logger from DI
    const logger = app.get(Logger);
    app.useLogger(logger);

    // Shutdown is handled below instead of app.enableShutdownHooks(): Nest's own handler closes
    // the database pools before the HTTP server, which fails whatever is still in flight.

    // get config service
    const config = app.get<ConfigPort>(ConfigPortToken);

    if (config.get('http.trustProxy')) app.set('trust proxy', 1);

    app.use(helmet());
    app.use(cookieParser());

    // server timeouts
    const server: HttpServer = app.getHttpServer();
    server.setTimeout(config.get('http.serverTimeout'));
    server.headersTimeout = config.get('http.headersTimeout')!;
    server.keepAliveTimeout = config.get('http.keepAliveTimeout')!;

    // body parsers with limits from config (Nest wraps express' parsers; no direct express import)
    app.useBodyParser('json', { limit: config.get('http.jsonBodyLimit') });
    app.useBodyParser('urlencoded', {
        extended: true,
        limit: config.get('http.urlencodedBodyLimit'),
    });

    // CORS: explicit allow-list only. With cookie auth, never reflect arbitrary origins.
    const corsOrigins = config.get('http.corsOrigins') ?? [];
    app.enableCors({
        origin: corsOrigins.length ? corsOrigins : false,
        credentials: true,
    });

    // set version to APIs, default v1
    app.enableVersioning({
        type: VersioningType.URI,
        defaultVersion: '1',
    });

    const swaggerPath = setupSwagger(app, config);

    const port = config.get('http.port');
    const env = config.get('app.env');
    await app.listen(port);

    installShutdownHandlers(app, server, config);

    const scheme = httpsOptions ? 'https' : 'http';
    logger.log(
        `API listening on ${scheme}://localhost:${port} [${env}]${swaggerPath ? ` docs: /${swaggerPath}` : ''}`,
    );
}

/**
 * Fail readiness first, keep serving while the load balancer notices, then close the server
 * and only afterwards the application (database pools).
 */
function installShutdownHandlers(
    app: NestExpressApplication,
    server: HttpServer,
    config: ConfigPort,
): void {
    const shutdown = app.get<ShutdownPort>(ShutdownPortToken);
    const logger = app.get<LoggerPort>(LoggerPortToken);
    const scheduler = app.get(JobScheduler);

    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        process.on(signal, () => {
            void runGracefulShutdown({
                signal,
                server,
                shutdown,
                logger,
                drainDelayMs: config.get('shutdown.drainDelayMs'),
                forceAfterMs: config.get('shutdown.forceAfterMs'),
                drainJobs: () => scheduler.stop(config.get('shutdown.jobDrainMs')),
                closeApp: () => app.close(),
            });
        });
    }
}

bootstrap().catch((error: unknown) => {
    if (error instanceof InvalidConfigError) {
        console.error(`❌ ${error.message}`);
    } else {
        console.error('❌ Failed to start application', error);
    }
    process.exit(1);
});
