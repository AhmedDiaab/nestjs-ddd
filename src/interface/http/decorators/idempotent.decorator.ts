import { SetMetadata } from '@nestjs/common';

export const IS_IDEMPOTENT = 'http:idempotent';

/**
 * Marks a handler as safe to replay: a request carrying a known `Idempotency-Key` header runs
 * at most once, and a retry with the same key and body gets the first response back instead of
 * running the handler again (see `IdempotencyInterceptor`).
 *
 * Opt-in, like `@Public()` and `@Roles()`: an endpoint where a repeat is a legitimate second
 * effect (an append-only log, say) should not silently start deduplicating just because a
 * client happens to send the header.
 */
export const Idempotent = () => SetMetadata(IS_IDEMPOTENT, true);
