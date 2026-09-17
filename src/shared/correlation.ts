/**
 * Correlation ids may be supplied by the caller and end up in every log line for that request,
 * so they are bounded to characters that are safe to print.
 */
export const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export const isSafeCorrelationId = (value: string | undefined): value is string =>
    !!value && SAFE_CORRELATION_ID.test(value);
