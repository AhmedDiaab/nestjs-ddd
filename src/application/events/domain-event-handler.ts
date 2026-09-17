import type { DomainEvent } from '@domain';
import { createToken } from '@shared';

/** Reacts to one event type (by `name`). Keep handlers idempotent: delivery may be retried. */
export interface DomainEventHandler<E extends DomainEvent = DomainEvent> {
    readonly eventName: E['name'];
    handle(event: E): Promise<void>;
}

/** All in-process handlers, collected in ApplicationModule. */
export const DomainEventHandlersToken =
    createToken<readonly DomainEventHandler[]>('DomainEventHandlers');
