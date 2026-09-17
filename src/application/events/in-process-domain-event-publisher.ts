import type { DomainEventPublisherPort, LoggerPort } from '@application/ports';
import type { DomainEvent } from '@domain';
import type { DomainEventHandler } from './domain-event-handler';

/**
 * Dispatches events to matching handlers, in order, after the caller's transaction committed.
 * A failing handler is logged and skipped: the data is already saved, so the request must not
 * fail. Use an outbox table instead when every event must be delivered.
 */
export class InProcessDomainEventPublisher implements DomainEventPublisherPort {
    constructor(
        private readonly handlers: readonly DomainEventHandler[],
        private readonly logger: LoggerPort,
    ) {}

    async publish(events: readonly DomainEvent[]): Promise<void> {
        for (const event of events) {
            for (const handler of this.handlers) {
                if (handler.eventName !== event.name) continue;
                try {
                    await handler.handle(event);
                } catch (err) {
                    this.logger.error('domain.event.handler.failed', {
                        event: event.name,
                        handler: handler.constructor.name,
                        err,
                    });
                }
            }
        }
    }
}
