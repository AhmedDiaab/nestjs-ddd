import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE = 'http:raw-response';

/**
 * Sends the handler's return value as it is, without the `{ success, data, meta }` envelope.
 *
 * For endpoints whose format is defined by someone else — a Prometheus scrape, a webhook
 * acknowledgement, a file — where wrapping the body makes it unreadable to its consumer.
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);
