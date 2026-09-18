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
 *
 * Guarantee: at-most-once, in process, after the commit. A crash between the commit and the
 * dispatch loses the event, and a handler that throws is logged, counted and skipped rather
 * than retried. Use it for side effects you can afford to lose, not for state another system
 * depends on; see `docs/guides/deliver-events-reliably.md` for an at-least-once recipe.
 */
export interface DomainEventPublisherPort {
    publish(events: readonly DomainEvent[]): Promise<void>;
}

export const DomainEventPublisherPortToken = createToken<DomainEventPublisherPort>(
    'DomainEventPublisherPort',
);
