# Add a value object and entity

Where: `src/domain/<feature>/`. Allowed imports: `@shared`, `@domain/errors`, `../base`, sibling domain files. No Nest, no infrastructure.

Background: [Domain layer](../architecture/domain-layer.md).

## 1. Value object

Validate in a static factory returning `Result`; keep the constructor private.

```ts
// src/domain/tickets/ticket-title.vo.ts
import { ValidationError } from '@domain/errors';
import { Result } from '@shared';
import { ValueObject } from '../base';

export class TicketTitle extends ValueObject<{ value: string }> {
    static readonly MAX_LENGTH = 200;

    private constructor(value: string) {
        super({ value });
    }

    /** The only way to get a TicketTitle: invalid titles never exist. */
    static create(raw: string): Result<TicketTitle, ValidationError> {
        const value = raw.trim();
        if (!value) {
            return Result.err(new ValidationError({ title: 'Title is required' }));
        }
        if (value.length > TicketTitle.MAX_LENGTH) {
            return Result.err(
                new ValidationError({
                    title: `Title must be at most ${TicketTitle.MAX_LENGTH} characters`,
                }),
            );
        }
        return Result.ok(new TicketTitle(value));
    }

    get value(): string {
        return this.props.value;
    }
}
```

`ValidationError({ field: message })` becomes HTTP **422** with the field map in `error.details`.

## 2. Domain error for a rule violation

```ts
// src/domain/tickets/ticket.errors.ts
import { DomainError } from '@domain/errors';
import { ProblemTypes, type ProblemLike } from '@shared';

export class TicketAlreadyClosedError extends DomainError {
    constructor(public readonly ticketId: string) {
        super(`Ticket ${ticketId} is already closed`);
    }

    override toProblem(): ProblemLike {
        return {
            kind: 'conflict', // → HTTP 409
            type: ProblemTypes.Conflict,
            title: 'Ticket already closed',
            detail: this.message,
        };
    }
}
```

More on status mapping: [Add an error](add-error.md).

## 3. Aggregate root

```ts
// src/domain/tickets/ticket.entity.ts
import { Result } from '@shared';
import { AggregateRoot, type DomainEvent } from '../base';
import type { TicketTitle } from './ticket-title.vo';
import { TicketAlreadyClosedError } from './ticket.errors';

export type TicketStatus = 'open' | 'closed';

export type TicketProps = {
    title: TicketTitle;
    status: TicketStatus;
    createdBy: string;
    createdAt: Date;
    closedAt?: Date;
};

export interface TicketClosed extends DomainEvent {
    readonly name: 'TicketClosed';
    readonly ticketId: string;
    readonly closedBy: string;
}

export class Ticket extends AggregateRoot<string, TicketProps> {
    private constructor(id: string, props: TicketProps) {
        super(id, props);
    }

    /** Business creation: applies rules and defaults. */
    static open(input: { id: string; title: TicketTitle; createdBy: string; now: Date }): Ticket {
        return new Ticket(input.id, {
            title: input.title,
            status: 'open',
            createdBy: input.createdBy,
            createdAt: input.now,
        });
    }

    /** Rehydration from storage: no rules, no events. Used by repository mappers only. */
    static restore(id: string, props: TicketProps): Ticket {
        return new Ticket(id, props);
    }

    close(closedBy: string, now: Date): Result<void, TicketAlreadyClosedError> {
        if (this.props.status === 'closed') {
            return Result.err(new TicketAlreadyClosedError(this.id));
        }
        this.props = { ...this.props, status: 'closed', closedAt: now };
        const event: TicketClosed = {
            name: 'TicketClosed',
            occurredAt: now,
            ticketId: this.id,
            closedBy,
        };
        this.addEvent(event);
        return Result.ok(undefined);
    }

    get title(): TicketTitle {
        return this.props.title;
    }
    get status(): TicketStatus {
        return this.props.status;
    }
    get createdBy(): string {
        return this.props.createdBy;
    }
    get createdAt(): Date {
        return this.props.createdAt;
    }
    get closedAt(): Date | undefined {
        return this.props.closedAt;
    }
}
```

Guidelines:

- Use a primitive id (`string` UUID); `Entity.equals` compares with `===`. The repository generates ids (`nextId()`).
- Inject time (`now`) as a parameter; don't call `new Date()` in the domain.
- Expose read-only getters; change state only through behaviour methods.
- Assign events to a typed variable before `addEvent` (object literals are excess-property checked against `DomainEvent`).
- If the entity isn't loaded/saved on its own, extend `Entity` instead of `AggregateRoot`.

## 4. Barrel exports

```ts
// src/domain/tickets/index.ts
export { TicketAlreadyClosedError } from './ticket.errors';
export { Ticket, type TicketClosed, type TicketProps, type TicketStatus } from './ticket.entity';
export { TicketTitle } from './ticket-title.vo';

// src/domain/index.ts
export { AggregateRoot, type DomainEvent, Entity, ValueObject } from './base';
export { AggregateNotFoundError, DomainError, ValidationError } from './errors';
export {
    type RepositoryOptions,
    type TicketRepository,
    TicketRepositoryToken,
} from './repositories';
export {
    Ticket,
    TicketAlreadyClosedError,
    type TicketClosed,
    type TicketProps,
    type TicketStatus,
    TicketTitle,
} from './tickets';
```

List every public name; `export *` is a lint error ([decision 0007](../decisions/0007-named-barrel-exports.md)). Mark types with `type`.

## 5. Test

See [Write tests → domain](write-tests.md#domain).

Next: [Add a repository](add-repository.md).
