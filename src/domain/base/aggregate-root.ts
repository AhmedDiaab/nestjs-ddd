import { Entity } from './entity';

export interface DomainEvent {
    readonly name: string;
    readonly occurredAt: Date;
}

/** Consistency boundary. Records domain events; the application layer publishes them after persisting. */
export abstract class AggregateRoot<Id, Props> extends Entity<Id, Props> {
    private events: DomainEvent[] = [];

    protected addEvent(event: DomainEvent): void {
        this.events.push(event);
    }

    pullEvents(): DomainEvent[] {
        const events = this.events;
        this.events = [];
        return events;
    }
}
