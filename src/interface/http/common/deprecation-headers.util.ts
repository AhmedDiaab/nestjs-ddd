import { z } from 'zod';
import { formatZodError } from './format-zod-error.util';

/**
 * Input to `@Deprecated(...)`. `since`/`sunset` are required — RFC 9745's `Deprecation` field has
 * no valueless (boolean) form, and a deprecation without a retirement date is a shrug, not a
 * policy.
 */
export type DeprecatedOptions = {
    /** 'YYYY-MM-DD' — the deprecation date, becomes `Deprecation: @<unix-seconds>`. */
    since: string;
    /** 'YYYY-MM-DD' — must not be earlier than `since`. */
    sunset: string;
    /** Absolute URL → `Link: <url>; rel="successor-version"` (RFC 5829, not RFC 9745). */
    successor?: string;
    /** Absolute URL → `Link: <url>; rel="deprecation"` (RFC 9745). */
    link?: string;
    /** Free text appended to the generated Swagger description. */
    note?: string;
};

/** The headers `formatDeprecationHeaders` produces, verbatim, for `DeprecationInterceptor`. */
export type DeprecationHeaders = {
    Deprecation: string;
    Sunset: string;
    Link?: string;
};

const deprecatedOptionsSchema = z
    .object({
        since: z.iso.date(),
        sunset: z.iso.date(),
        successor: z.url().optional(),
        link: z.url().optional(),
        note: z.string().optional(),
    })
    .superRefine((value, ctx) => {
        if (value.sunset < value.since) {
            ctx.addIssue({
                code: 'custom',
                path: ['sunset'],
                message: `sunset (${value.sunset}) must not be earlier than since (${value.since})`,
            });
        }
    });

/**
 * Validates `@Deprecated(...)`'s options, throwing a plain `Error` on a bad value.
 *
 * Called from the decorator factory, so a mistake throws at module load — effectively at boot,
 * the same fail-fast posture as `InvalidConfigError` — rather than on the route's first request.
 * A plain `Error`, not an `AppError`/`DomainError`: this is a programmer mistake caught before
 * any request exists, not a runtime failure with an HTTP status.
 */
export function parseDeprecatedOptions(options: DeprecatedOptions): DeprecatedOptions {
    const parsed = deprecatedOptionsSchema.safeParse(options);
    if (!parsed.success) {
        const { message, details } = formatZodError(parsed.error);
        throw new Error(`Invalid @Deprecated(...) options: ${message}: ${details.join('; ')}`);
    }
    return parsed.data;
}

/**
 * Formats already-valid options into the exact header values `DeprecationInterceptor` sets.
 * Pure: no validation here, so its tests never have to fake `parseDeprecatedOptions`'s input.
 *
 * Both dates are read as UTC midnight of the given day — the only reading available when the
 * input is a date with no time of day. A past `since`/`sunset` formats exactly like a future one:
 * these headers are advisory, so there is no special-casing for "already deprecated/sunset".
 */
export function formatDeprecationHeaders(options: DeprecatedOptions): DeprecationHeaders {
    const sinceSeconds = Math.floor(Date.parse(`${options.since}T00:00:00Z`) / 1000);
    const sunsetDate = new Date(`${options.sunset}T00:00:00Z`);

    const headers: DeprecationHeaders = {
        Deprecation: `@${sinceSeconds}`,
        Sunset: sunsetDate.toUTCString(),
    };

    // RFC 8288 §3: multiple Link values join with ", " in one header.
    const links = [
        options.successor ? `<${options.successor}>; rel="successor-version"` : undefined,
        options.link ? `<${options.link}>; rel="deprecation"` : undefined,
    ].filter((value): value is string => value !== undefined);
    if (links.length > 0) headers.Link = links.join(', ');

    return headers;
}
