import type { Server as HttpServer } from 'node:http';
import type { ConfigPort } from '@application/ports/config.port';
import { ConfigPortToken } from '@infrastructure/config/config.token';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
    const app: INestApplication = await NestFactory.create(AppModule, {
        bufferLogs: true,
    });

    // use logger from DI
    const logger = app.get(Logger);
    app.useLogger(logger);

    // get config service
    const config = app.get<ConfigPort>(ConfigPortToken);

    // set timeout to 2 minutes
    const server: HttpServer = app.getHttpServer() as HttpServer;

    const serverTimeout = config.get<number>('http.serverTimeout')!;
    const headersTimeout = config.get<number>('http.headersTimeout')!;
    const keepAliveTimeout = config.get<number>('http.keepAliveTimeout')!;

    server.setTimeout(serverTimeout);
    server.headersTimeout = headersTimeout;
    server.keepAliveTimeout = keepAliveTimeout;

    // limit payload size
    const jsonBodyLimit = config.get<string>('http.jsonBodyLimit')!;
    const urlencodedBodyLimit = config.get<string>('http.urlencodedBodyLimit')!;

    app.use(json({ limit: jsonBodyLimit }));
    app.use(urlencoded({ extended: true, limit: urlencodedBodyLimit }));

    // enable CORS
    app.enableCors({
        origin: true,
        credentials: true,
    });

    // set version to APIs, default v1
    app.enableVersioning({
        type: VersioningType.URI,
        defaultVersion: '1',
    });

    const port = config.get<number>('http.port')!;
    const env = config.get<string>('app.env')!;
    await app.listen(port);

    logger.log(`API listening on http://localhost:${port} [${env}]`, {});
}

void bootstrap();
