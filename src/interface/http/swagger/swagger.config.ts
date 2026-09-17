import { DocumentBuilder } from '@nestjs/swagger';
import {
    BEARER_SECURITY,
    COOKIE_SECURITY,
    SWAGGER_API_DESCRIPTION,
    SWAGGER_API_TITLE,
    SWAGGER_API_VERSION,
} from './swagger.constants';

export const buildSwaggerConfig = (cookieName: string) =>
    new DocumentBuilder()
        .setTitle(SWAGGER_API_TITLE)
        .setDescription(SWAGGER_API_DESCRIPTION)
        .setVersion(SWAGGER_API_VERSION)
        .addCookieAuth(cookieName, { in: 'cookie', type: 'apiKey' }, COOKIE_SECURITY)
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, BEARER_SECURITY)
        .build();
