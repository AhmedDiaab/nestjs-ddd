# Domain layer

`src/domain`: business rules only. No Nest, no database, no HTTP. Imports allowed: `@shared` and the domain itself (ESLint enforces this).

## Building blocks (`src/domain/base`)

| Class                      | Identity                                          | Use for                                                |
| -------------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| `ValueObject<Props>`       | by value (`equals` compares props)                | validated values: titles, emails, money, site names    |
| `Entity<Id, Props>`        | by `id`                                           | things with a lifecycle                                |
| `AggregateRoot<Id, Props>` | entity + domain events (`addEvent`, `pullEvents`) | consistency boundary loaded/saved through a repository |

`Entity.equals` compares ids with `===`, so use a primitive id (e.g. a UUID `string`).

## Patterns

**Value objects validate in a static factory and return a `Result`:**

```ts
export class TicketTitle extends ValueObject<{ value: string }> {
    private constructor(value: string) {
        super({ value });
    }

    static create(raw: string): Result<TicketTitle, ValidationError> {
        const value = raw.trim();
        if (!value) return Result.err(new ValidationError({ title: 'Title is required' }));
        return Result.ok(new TicketTitle(value));
    }

    get value(): string {
        return this.props.value;
    }
}
```

Invalid instances can't exist, so code that receives a `TicketTitle` never re-validates.

**Aggregates have two factories:**

- `open(...)` / `create(...)`: business creation; applies rules and defaults, may record events.
- `restore(id, props)`: rehydration from storage; no rules, no events. Only repository mappers call it.

**Behaviour methods return `Result` for rule violations:**

```ts
close(closedBy: string, now: Date): Result<void, TicketAlreadyClosedError> {
    if (this.props.status === 'closed') return Result.err(new TicketAlreadyClosedError(this.id));
    this.props = { ...this.props, status: 'closed', closedAt: now };
    this.addEvent(event);
    return Result.ok(undefined);
}
```

Pass time (`now`) in instead of calling `new Date()` inside the domain, so tests stay deterministic.

**Repository interfaces** for aggregates live in `src/domain/repositories` with their token. See [Add a repository](../guides/add-repository.md).

## Domain errors (`src/domain/errors`)

| Error                                   | Default problem kind → HTTP                                   |
| --------------------------------------- | ------------------------------------------------------------- |
| `DomainError` (base)                    | `validation` → 422                                            |
| `ValidationError(fieldErrors)`          | `validation` → 422; `fieldErrors` returned as `error.details` |
| `AggregateNotFoundError(aggregate, id)` | `not_found` → 404                                             |

Subclass `DomainError` and override `toProblem()` to choose another kind (e.g. `conflict` → 409). See [Add an error](../guides/add-error.md).

## Domain events

`AggregateRoot` records events (`addEvent`); the use case publishes them **after the change is committed**:

```ts
await this.tickets.save(ticket, { actor: username });
await this.events.publish(ticket.pullEvents()); // DomainEventPublisherPortToken
```

With a unit of work, publish after `unitOfWork.run(...)` returns successfully, never inside it (a rollback would leave handlers acting on data that doesn't exist).

React to an event with a handler in the application layer:

```ts
// src/application/events/handlers/notify-ticket-closed.handler.ts
@Injectable()
export class NotifyTicketClosedHandler implements DomainEventHandler<TicketClosed> {
    readonly eventName = 'TicketClosed';

    constructor(@Inject(LoggerPortToken) private readonly logger: LoggerPort) {}

    handle(event: TicketClosed): Promise<void> {
        this.logger.info('tickets.closed.notified', { ticketId: event.ticketId });
        return Promise.resolve();
    }
}
```

Register it in the `eventHandlers` list in `src/application/application.module.ts`.

| Behaviour           | Default (`InProcessDomainEventPublisher`)                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Delivery            | in process, handlers matched by `eventName`, run one after another                               |
| Handler throws      | logged as `domain.event.handler.failed`; other handlers still run; the request doesn't fail      |
| Guaranteed delivery | not provided: write events to an outbox table in the same unit of work and publish from a worker |
| Message broker      | bind `DomainEventPublisherPortToken` to a broker adapter in infrastructure instead               |

## Auth types

`src/domain/auth/jwt-payload.interface.ts` (`JWTPayload`) is the token payload attached to `req.user`. It's a transport shape kept here for sharing. Pass plain values (`username`) into use cases rather than the whole payload.
