# Add a use case

Where: `src/application/use-cases/<feature>/<verb>-<noun>.use-case.ts`, registered in `src/application/application.module.ts`.

Background: [Application layer](../architecture/application-layer.md).

## 1. Command use case (changes state)

```ts
// src/application/use-cases/tickets/open-ticket.use-case.ts
import { UseCase } from '@common/base';
import {
    Ticket,
    TicketRepositoryToken,
    TicketTitle,
    type TicketRepository,
    type ValidationError,
} from '@domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';

type Input = { title: string; username: string };
type Output = { id: string };

@Injectable()
export class OpenTicketUseCase extends UseCase<Input, Output, ValidationError> {
    constructor(@Inject(TicketRepositoryToken) private readonly tickets: TicketRepository) {
        super();
    }

    async execute(input: Input): Promise<Result<Output, ValidationError>> {
        const title = TicketTitle.create(input.title);
        if (!title.ok) return this.err(title.error); // → 422 with field errors

        const ticket = Ticket.open({
            id: this.tickets.nextId(),
            title: title.value,
            createdBy: input.username,
            now: new Date(),
        });

        await this.tickets.save(ticket, { actor: input.username });
        return this.ok({ id: ticket.id });
    }
}
```

```ts
// src/application/use-cases/tickets/close-ticket.use-case.ts
import { NotFoundError } from '@application/errors';
import { UseCase } from '@common/base';
import {
    TicketRepositoryToken,
    type TicketAlreadyClosedError,
    type TicketRepository,
} from '@domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';

type Input = { id: string; username: string };
type Output = { id: string; status: 'closed' };
type Failure = NotFoundError | TicketAlreadyClosedError;

@Injectable()
export class CloseTicketUseCase extends UseCase<Input, Output, Failure> {
    constructor(@Inject(TicketRepositoryToken) private readonly tickets: TicketRepository) {
        super();
    }

    async execute(input: Input): Promise<Result<Output, Failure>> {
        const options = { actor: input.username };

        const ticket = await this.tickets.findById(input.id, options);
        if (!ticket) return this.err(new NotFoundError(`Ticket ${input.id} not found`)); // → 404

        const closed = ticket.close(input.username, new Date());
        if (!closed.ok) return this.err(closed.error); // → 409

        await this.tickets.save(ticket, options);
        return this.ok({ id: ticket.id, status: 'closed' });
    }
}
```

Shape of a command: load → call domain behaviour → on `Result.err` return it → save → return a small output (ids, new status). Don't return the aggregate itself.

## 2. Query use case (reads)

```ts
// src/application/use-cases/tickets/get-ticket.use-case.ts
import { NotFoundError } from '@application/errors';
import { TicketQueryPortToken, type TicketQueryPort, type TicketSummary } from '@application/ports';
import { UseCase } from '@common/base';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';

type Input = { id: string; username: string };

@Injectable()
export class GetTicketUseCase extends UseCase<Input, TicketSummary, NotFoundError> {
    constructor(@Inject(TicketQueryPortToken) private readonly queries: TicketQueryPort) {
        super();
    }

    async execute(input: Input): Promise<Result<TicketSummary, NotFoundError>> {
        const ticket = await this.queries.findById(input.id, { actor: input.username });
        return ticket
            ? this.ok(ticket)
            : this.err(new NotFoundError(`Ticket ${input.id} not found`));
    }
}
```

```ts
// src/application/use-cases/tickets/list-tickets.use-case.ts
import {
    TicketQueryPortToken,
    type PageRequest,
    type TicketListFilter,
    type TicketQueryPort,
    type TicketSort,
    type TicketSummary,
} from '@application/ports';
import { UseCase } from '@common/base';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';
import type { PageEnvelope } from '@shared/pagination';

type Input = { filter: TicketListFilter; page: PageRequest<TicketSort>; username: string };
type Output = PageEnvelope<TicketSummary>;

@Injectable()
export class ListTicketsUseCase extends UseCase<Input, Output, never> {
    constructor(@Inject(TicketQueryPortToken) private readonly queries: TicketQueryPort) {
        super();
    }

    async execute(input: Input): Promise<Result<Output, never>> {
        return this.ok(
            await this.queries.list(input.filter, input.page, { actor: input.username }),
        );
    }
}
```

## 3. Register

```ts
// src/application/use-cases/tickets/index.ts
export { CloseTicketUseCase } from './close-ticket.use-case';
export { GetTicketUseCase } from './get-ticket.use-case';
export { ListTicketsUseCase } from './list-tickets.use-case';
export { OpenTicketUseCase } from './open-ticket.use-case';

// src/application/use-cases/index.ts
export * from './tickets';
```

```ts
// src/application/application.module.ts
@Module({
    providers: [
        GetDatabaseInfoUseCase,
        OpenTicketUseCase,
        CloseTicketUseCase,
        GetTicketUseCase,
        ListTicketsUseCase,
    ],
    exports: [
        GetDatabaseInfoUseCase,
        OpenTicketUseCase,
        CloseTicketUseCase,
        GetTicketUseCase,
        ListTicketsUseCase,
    ],
})
export class ApplicationModule {}
```

Don't import infrastructure modules here; ports are provided by global infrastructure modules.

## Rules

| Do                                                                              | Don't                                                                                |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Inject ports by token (`@Inject(TicketRepositoryToken)`)                        | Inject DAOs, `PoolManager`, `ConnectionProvider`                                     |
| Take plain input (`username`, ids, strings)                                     | Take `Request`, `JWTPayload`, DTO classes                                            |
| Return `this.err(...)` for expected failures, typed in `UseCase<I, O, Failure>` | Throw `HttpException` or build HTTP responses                                        |
| Pass `actor: input.username` to every port call                                 | Read the user from a global/request scope                                            |
| Keep rules in the domain; orchestrate here                                      | Re-implement validation that a value object owns                                     |
| Call another use case's logic through ports or a domain service                 | Inject use cases into use cases (hidden coupling; if unavoidable, keep it one level) |

Configuration in a use case: inject `ConfigPortToken`, read `config.get<number>('tickets.maxPageSize')`.

Logging: inject `LoggerPortToken`; log business events at `info` and rejected rules at `warn` only when useful. HTTP failures are already logged by the filter.

Next: [Add a controller](add-controller.md). Tests: [Write tests → use cases](write-tests.md#use-cases).
