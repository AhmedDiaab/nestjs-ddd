import type { ConfigPort } from '@application/ports';
import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { buildSwaggerConfig } from './swagger.config';
import { SWAGGER_API_PATH } from './swagger.constants';

/** Enabled by SWAGGER_ENABLED; defaults to off in production. Returns the path when mounted. */
export function setupSwagger(app: INestApplication, config: ConfigPort): string | undefined {
    const enabled = config.get<boolean>('http.swaggerEnabled') ?? !config.isProduction();
    if (!enabled) return undefined;

    const cookieName = config.get<string>('jwt.cookieName') ?? 'jwt';
    const document = SwaggerModule.createDocument(app, buildSwaggerConfig(cookieName));

    SwaggerModule.setup(SWAGGER_API_PATH, app, document, {
        swaggerOptions: {
            persistAuthorization: true,
        },
    });
    return SWAGGER_API_PATH;
}
