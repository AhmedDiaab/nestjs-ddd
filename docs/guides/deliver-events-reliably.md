# Deliver events reliably (outbox recipe)

`DomainEventPublisherPort`'s default binding, `InProcessDomainEventPublisher`, is **at-most-once, in process, after the commit** (see [Application layer → Delivery guarantees](../architecture/application-layer.md#delivery-guarantees)). A crash between the commit and the dispatch loses the event, and nothing retries a failing handler.

That is fine for a cache invalidation or a notification — the kind of side effect a request can survive losing. It is **not** fine when another system's state depends on receiving every event: a billing system that must see every `OrderPlaced`, a downstream service that maintains its own read model from your events. That needs **at-least-once** delivery, and this template does not ship it.

## Why not

At-least-once delivery is a real subsystem, not a flag: a durable queue for undelivered events, retry with backoff, a way to tell a handler "you may see this twice," and monitoring for a backlog that stops draining. Building it generically, for every project that forks this template, means guessing at throughput, retention and failure-handling needs none of them share. The pattern below is a recipe to build **when a feature actually needs it**, not a port shipped unused in the common case.

## The recipe: transactional outbox

| Piece          | Location                                                                       |
| -------------- | ------------------------------------------------------------------------------ |
| `OUTBOX` table | new migration, owned by this service                                           |
| Row insert     | inside the same `UnitOfWorkPort.run(...)` as the aggregate save                |
| Drain job      | a `ScheduledJob` on the existing `JobRunner` ([guide](add-a-scheduled-job.md)) |
| Backoff        | `attempts` and `next_attempt_at` columns on `OUTBOX`                           |
| Dedupe         | on the consumer, keyed by the event's id                                       |

### 1. Write the event in the same transaction as the aggregate

The guarantee an outbox buys you comes entirely from this step: the event row and the aggregate's row share one commit, so there is no window where one exists without the other.

```ts
// application use case
return this.unitOfWork.run(
    async () => {
        const ticket = await this.tickets.findById(input.id, { actor });
        if (!ticket) return this.err(new NotFoundError(`Ticket ${input.id} not found`));

        const closed = ticket.close(input.username, new Date());
        if (!closed.ok) return this.err(closed.error);

        await this.tickets.save(ticket, { actor });
        // same transaction: either both rows land, or neither does
        await this.outbox.append(ticket.pullEvents(), { actor });

        return this.ok({ id: ticket.id, status: 'closed' as const });
    },
    { actor },
);
```

`OutboxPort.append(events, options)` is an application port you add for this, backed by a repository that inserts one `OUTBOX` row per event: an id, the event name, a JSON payload, `created_at`, `attempts` (starts at 0) and `next_attempt_at` (starts at now). Do **not** call `DomainEventPublisherPortToken` for events that go through the outbox — publishing them twice defeats the point.

### 2. Drain the table on a schedule

A `ScheduledJob` (the same mechanism [Add a scheduled job](add-a-scheduled-job.md) already covers) polls for due rows, sends each to its consumer (another service over HTTP, a queue, whatever the event's destination is), and marks it delivered:

```ts
@Injectable()
export class DrainOutboxJob implements ScheduledJob {
    readonly name = 'events.drainOutbox';
    readonly cronTime = '*/10 * * * * *'; // every 10s

    constructor(private readonly drainOutbox: DrainOutboxUseCase) {}

    async run(): Promise<void> {
        const result = await this.drainOutbox.execute({ batchSize: 100 });
        if (!result.ok) throw result.error;
    }
}
```

The use case behind it, per row: send, then either delete the row (or mark it `delivered`) on success, or increment `attempts` and push `next_attempt_at` out (exponential backoff, with a ceiling) on failure. A row stuck past a threshold of attempts is a **dead letter** — stop retrying it automatically and alert instead; see [Observability → Worth alerting on](../architecture/observability.md#worth-alerting-on) for the shape of that alert (a backlog that isn't draining is exactly the "job silently stops" signal already listed there).

### 3. Dedupe on the consumer

At-least-once means a row can be sent more than once — the drain job crashing between "send" and "mark delivered" resends it. The event needs a stable id (the `OUTBOX` row's id, or one you generate when the event is created), and the consumer needs to recognize and skip an id it has already applied. This half of the contract lives on the receiving side and can't be built here — document it as a requirement for whoever owns that consumer.

## What you get, and what you still don't

| Property                                     | In-process publisher | Outbox                                             |
| -------------------------------------------- | -------------------- | -------------------------------------------------- |
| Survives a crash between commit and dispatch | no                   | yes (row is durable)                               |
| Delivered if the consumer is briefly down    | no                   | yes (retried)                                      |
| Exactly-once                                 | no                   | no — still at-least-once; the consumer must dedupe |
| Ordering across different aggregates         | not guaranteed       | not guaranteed unless you add it                   |

An outbox does not give you exactly-once or global ordering. It trades "might lose it" for "might deliver it twice," which is the trade almost every system that needs reliability actually wants — duplicates are usually easier to handle than silent loss.

## Related

- [Application layer → Delivery guarantees](../architecture/application-layer.md#delivery-guarantees)
- [Add a scheduled job](add-a-scheduled-job.md)
- [Add a repository](add-repository.md#multiple-aggregates-in-one-transaction) for `UnitOfWorkPort`
- `docs/known-gaps.md` section 2, row 4 (queues and outbox)
