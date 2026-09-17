import type { DomainEvent } from '@domain';
import { createToken } from '@shared';

/**
 * Hands domain events to whoever reacts to them. Publish only after the change is committed:
 *
 *     await this.tickets.save(ticket, { actor });
 *     await this.events.publish(ticket.pullEvents());
 *
 * The default binding dispatches in process to `DomainEventHandler`s; a broker adapter can
 * replace it by binding this token in infrastructure.
 */
export interface DomainEventPublisherPort {
    publish(events: readonly DomainEvent[]): Promise<void>;
}

export const DomainEventPublisherPortToken = createToken<DomainEventPublisherPort>(
    'DomainEventPublisherPort',
);
