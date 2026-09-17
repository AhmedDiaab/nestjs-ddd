import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:public';

/**
 * Opens a route (or a whole controller) to unauthenticated callers.
 *
 * Authentication is global: every route needs a valid token unless it says otherwise,
 * so forgetting a decorator locks a route down instead of exposing it.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
