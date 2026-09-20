import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import {
    formatDeprecationHeaders,
    parseDeprecatedOptions,
    type DeprecatedOptions,
} from '../common/deprecation-headers.util';

export const DEPRECATION_METADATA = 'http:deprecated';

/**
 * Marks a route deprecated: responses carry the standard `Deprecation`/`Sunset`/`Link` headers
 * (RFC 9745, RFC 8594, RFC 5829 — see `deprecation-headers.util.ts`) and Swagger shows the
 * operation as `deprecated: true`.
 *
 * `since`/`sunset` are validated here, in the decorator factory, with Zod — a bad date throws
 * immediately, at module load (effectively at boot), rather than surfacing on the route's first
 * request. The *formatted* headers, not the raw options, are what land in metadata, so
 * `DeprecationInterceptor` does no parsing or formatting work per request.
 *
 * @example
 * @Deprecated({
 *     since: '2026-01-01',
 *     sunset: '2026-12-31',
 *     successor: 'https://api.example.com/v2/orders',
 *     link: 'https://docs.example.com/deprecations/orders-v1',
 *     note: 'Use v2 instead; v1 stops serving after the sunset date.',
 * })
 */
export function Deprecated(options: DeprecatedOptions): MethodDecorator {
    const parsed = parseDeprecatedOptions(options);
    const headers = formatDeprecationHeaders(parsed);

    const description = [`Deprecated since ${parsed.since}; sunset ${parsed.sunset}.`, parsed.note]
        .filter((part): part is string => !!part)
        .join(' ');

    return applyDecorators(
        SetMetadata(DEPRECATION_METADATA, headers),
        ApiOperation({ deprecated: true, description }),
    );
}
