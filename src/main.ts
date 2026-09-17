import type { Server as HttpServer } from 'node:http';
import type { ConfigPort } from '@application/ports';
import { ConfigPortToken } from '@application/ports';
import { InvalidConfigError } from '@infrastructure/config';
import { setupSwagger } from '@interface/http/swagger';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        bufferLogs: true,
        bodyParser: false, // configured below with limits from config
    });

    // use logger from DI
    const logger = app.get(Logger);
    app.useLogger(logger);

    // run OnModuleDestroy (DB pool drain) on SIGTERM/SIGINT
    app.enableShutdownHooks();

    // get config service
    const config = app.get<ConfigPort>(ConfigPortToken);

    if (config.get<boolean>('http.trustProxy')) app.set('trust proxy', 1);

    app.use(helmet());
    app.use(cookieParser());

    // server timeouts
    const server: HttpServer = app.getHttpServer();
    server.setTimeout(config.get<number>('http.serverTimeout'));
    server.headersTimeout = config.get<number>('http.headersTimeout')!;
    server.keepAliveTimeout = config.get<number>('http.keepAliveTimeout')!;

    // body parsers with limits from config (Nest wraps express' parsers; no direct express import)
    app.useBodyParser('json', { limit: config.get<string>('http.jsonBodyLimit') });
    app.useBodyParser('urlencoded', {
        extended: true,
        limit: config.get<string>('http.urlencodedBodyLimit'),
    });

    // CORS: explicit allow-list only. With cookie auth, never reflect arbitrary origins.
    const corsOrigins = config.get<string[]>('http.corsOrigins') ?? [];
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

    const port = config.get<number>('http.port')!;
    const env = config.get<string>('app.env')!;
    await app.listen(port);

    logger.log(
        `API listening on http://localhost:${port} [${env}]${swaggerPath ? ` docs: /${swaggerPath}` : ''}`,
    );
}

bootstrap().catch((error: unknown) => {
    if (error instanceof InvalidConfigError) {
        console.error(`❌ ${error.message}`);
    } else {
        console.error('❌ Failed to start application', error);
    }
    process.exit(1);
});
