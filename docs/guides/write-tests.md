# Write tests

Background: [Testing](../architecture/testing.md). Run `pnpm test`, `pnpm test:e2e`, and `pnpm typecheck` (Jest doesn't type-check).

Files mirror `src`: `src/domain/tickets/ticket.entity.ts` → `test/unit/domain/tickets/ticket.entity.spec.ts`.

## Domain

Pure tests, no mocks.

```ts
// test/unit/domain/tickets/ticket.entity.spec.ts
import { Ticket, TicketAlreadyClosedError, TicketTitle, ValidationError } from '@domain';

const title = (raw = 'Printer is down') => {
    const result = TicketTitle.create(raw);
    if (!result.ok) throw result.error;
    return result.value;
};

describe('TicketTitle', () => {
    it.each(['', '   ', 'x'.repeat(TicketTitle.MAX_LENGTH + 1)])('rejects %p', (raw) => {
        const result = TicketTitle.create(raw);
        expect(!result.ok && result.error).toBeInstanceOf(ValidationError);
    });
});

describe('Ticket', () => {
    const now = new Date('2026-01-01T10:00:00Z');
    const open = () => Ticket.open({ id: 't-1', title: title(), createdBy: 'alice', now });

    it('closes once and records TicketClosed', () => {
        const ticket = open();
        const later = new Date('2026-01-02T10:00:00Z');

        expect(ticket.close('bob', later).ok).toBe(true);
        expect(ticket.pullEvents()).toEqual([
            { name: 'TicketClosed', occurredAt: later, ticketId: 't-1', closedBy: 'bob' },
        ]);
    });

    it('refuses to close twice', () => {
        const ticket = open();
        ticket.close('bob', now);
        const second = ticket.close('bob', now);
        expect(!second.ok && second.error).toBeInstanceOf(TicketAlreadyClosedError);
    });
});
```

Pattern for asserting a failed `Result`: `expect(!result.ok && result.error).toBeInstanceOf(ErrorClass)`.

## Fakes

In-memory port implementations live in `test/fakes`. One fake per storage concept can serve several ports.

```ts
// test/fakes/in-memory-tickets.ts
import { randomUUID } from 'node:crypto';
import type { TicketQueryPort, TicketSummary } from '@application/ports';
import type { RepositoryOptions, Ticket, TicketRepository } from '@domain';

/**
 * In-memory stand-in for the tickets table.
 * `repository` implements the domain port, `queries` the read port; both share one store.
 */
export class InMemoryTickets {
    readonly store = new Map<string, Ticket>();
    readonly actors: (string | undefined)[] = [];

    readonly repository: TicketRepository = {
        nextId: () => randomUUID(),
        findById: (id) => Promise.resolve(this.store.get(id)),
        save: (ticket: Ticket, options?: RepositoryOptions) => {
            this.actors.push(options?.actor);
            this.store.set(ticket.id, ticket);
            return Promise.resolve();
        },
    };

    readonly queries: TicketQueryPort = {
        findById: (id) => {
            const ticket = this.store.get(id);
            return Promise.resolve(ticket ? toSummary(ticket) : undefined);
        },
        list: (filter, page) => {
            const all = [...this.store.values()]
                .filter((t) => !filter.status || t.status === filter.status)
                .map(toSummary);
            const start = (page.page - 1) * page.size;
            return Promise.resolve({
                data: all.slice(start, start + page.size),
                meta: { hasNext: all.length > start + page.size, hasPrev: page.page > 1 },
            });
        },
    };
}

function toSummary(ticket: Ticket): TicketSummary {
    return {
        id: ticket.id,
        title: ticket.title.value,
        status: ticket.status,
        createdBy: ticket.createdBy,
        createdAt: ticket.createdAt.toISOString(),
        closedAt: ticket.closedAt?.toISOString() ?? null,
    };
}
```

Typing a fake as the port (`TicketRepository`) makes the compiler flag it when the port changes. Return `Promise.resolve(...)` instead of `async` without `await` (lint rule `require-await`).

## Use cases

Construct directly with fakes. No Nest testing module needed.

```ts
// test/unit/application/use-cases/tickets/tickets.use-cases.spec.ts
import { NotFoundError } from '@application/errors';
import { CloseTicketUseCase, OpenTicketUseCase } from '@application/use-cases';
import { TicketAlreadyClosedError, ValidationError } from '@domain';
import { InMemoryTickets } from '../../../../fakes/in-memory-tickets';

describe('ticket use cases', () => {
    let tickets: InMemoryTickets;
    let openTicket: OpenTicketUseCase;
    let closeTicket: CloseTicketUseCase;

    beforeEach(() => {
        tickets = new InMemoryTickets();
        openTicket = new OpenTicketUseCase(tickets.repository);
        closeTicket = new CloseTicketUseCase(tickets.repository);
    });

    it('opens a ticket and saves it as the acting user', async () => {
        const result = await openTicket.execute({ title: 'Printer', username: 'alice' });

        expect(result.ok).toBe(true);
        const id = result.ok ? result.value.id : '';
        expect(tickets.store.get(id)?.createdBy).toBe('alice');
        expect(tickets.actors).toEqual(['alice']);
    });

    it('returns a ValidationError for an empty title without saving', async () => {
        const result = await openTicket.execute({ title: ' ', username: 'alice' });

        expect(!result.ok && result.error).toBeInstanceOf(ValidationError);
        expect(tickets.store.size).toBe(0);
    });

    it('returns NotFoundError for an unknown ticket', async () => {
        const result = await closeTicket.execute({ id: 'missing', username: 'bob' });
        expect(!result.ok && result.error).toBeInstanceOf(NotFoundError);
    });

    it('returns TicketAlreadyClosedError when closing twice', async () => {
        const opened = await openTicket.execute({ title: 'Printer', username: 'alice' });
        const id = opened.ok ? opened.value.id : '';
        await closeTicket.execute({ id, username: 'bob' });

        const result = await closeTicket.execute({ id, username: 'bob' });

        expect(!result.ok && result.error).toBeInstanceOf(TicketAlreadyClosedError);
    });
});
```

Cover every failure in the use case's `Failure` union, plus "nothing was saved" on failure.

## Infrastructure adapters

Mock `ConnectionProvider`. `withConnection`/`transaction` just invoke the callback with a mocked connection.

```ts
// test/unit/infrastructure/database/repositories/oracle-ticket.repository.spec.ts
import { Ticket, TicketTitle } from '@domain';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { OracleTicketRepository } from '@infrastructure/database/repositories/oracle-ticket.repository';

describe('OracleTicketRepository', () => {
    const connection = { execute: jest.fn() };
    const db = {
        withConnection: jest.fn((_key: string, fn: (c: unknown) => Promise<unknown>) =>
            fn(connection),
        ),
        transaction: jest.fn((_key: string, fn: (c: unknown) => Promise<unknown>) =>
            fn(connection),
        ),
    };
    const sut = new OracleTicketRepository(db as unknown as ConnectionProvider);

    afterEach(() => jest.clearAllMocks());

    it('maps a row to the Ticket aggregate and passes the actor as context user', async () => {
        connection.execute.mockResolvedValueOnce({
            rows: [
                {
                    ID: 't-1',
                    TITLE: 'Printer',
                    STATUS: 'open',
                    CREATED_BY: 'alice',
                    CREATED_AT: new Date('2026-01-01T00:00:00Z'),
                    CLOSED_AT: null,
                },
            ],
        });

        const ticket = await sut.findById('t-1', { actor: 'bob' });

        expect(ticket).toBeInstanceOf(Ticket);
        expect(db.withConnection).toHaveBeenCalledWith('main', expect.any(Function), {
            contextUser: 'bob',
            tag: 'tickets.findById',
        });
    });

    it('saves inside a transaction with bind values from the aggregate', async () => {
        const title = TicketTitle.create('Printer');
        if (!title.ok) throw title.error;
        const ticket = Ticket.open({
            id: 't-1',
            title: title.value,
            createdBy: 'alice',
            now: new Date('2026-01-01T00:00:00Z'),
        });

        await sut.save(ticket, { actor: 'alice' });

        expect(db.transaction).toHaveBeenCalledWith('main', expect.any(Function), {
            contextUser: 'alice',
            tag: 'tickets.save',
        });
        expect(connection.execute).toHaveBeenCalledWith(
            expect.stringContaining('MERGE INTO tickets'),
            expect.objectContaining({
                id: 't-1',
                title: 'Printer',
                status: 'open',
                closedAt: null,
            }),
        );
    });
});
```

Query DAO paging:

```ts
it('fetches size + 1 rows to compute hasNext and uses fixed ORDER BY SQL', async () => {
    connection.execute.mockResolvedValueOnce({ rows: [row('1'), row('2'), row('3')] });

    const page = await sut.list({}, { page: 2, size: 2, orderBy: 'title:asc' }, { actor: 'bob' });

    expect(page.data.map((t) => t.id)).toEqual(['1', '2']);
    expect(page.meta).toEqual({ hasNext: true, hasPrev: true });
    const [sql, binds] = connection.execute.mock.calls[0] as [string, Record<string, unknown>];
    expect(sql).toContain('ORDER BY title ASC, id ASC');
    expect(binds).toEqual({ status: null, rowOffset: 2, rowLimit: 3 });
});
```

What to assert in adapter tests:

- source key, `contextUser` and `tag`
- SQL fragments that matter (table, `ORDER BY`)
- exact binds
- row → model mapping
- writes use `transaction`

These tests don't prove the SQL runs; see [Real database](#real-database).

## HTTP end to end

Boot the real `AppModule`, override ports with fakes, sign a JWT.

```ts
// test/e2e/tickets.e2e-spec.ts
import { TicketQueryPortToken } from '@application/ports';
import { TicketRepositoryToken } from '@domain';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import request from 'supertest';
import type { App } from 'supertest/types';
import { InMemoryTickets } from '../fakes/in-memory-tickets';

const SECRET = 'e2e-secret-that-is-at-least-32-chars';

describe('Tickets API (e2e, in-memory persistence)', () => {
    let app: INestApplication<App>;
    let token: string;
    const tickets = new InMemoryTickets();

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: SECRET,
            LOGGING_TO_FILE: 'false',
            LOG_LEVEL: 'error',
        });
        delete process.env.DATABASE_CONFIG_JSON;

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(TicketRepositoryToken)
            .useValue(tickets.repository)
            .overrideProvider(TicketQueryPortToken)
            .useValue(tickets.queries)
            .compile();

        app = moduleRef.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();

        token = new JwtService({ secret: SECRET }).sign({ username: 'alice', id: '1' });
    });

    afterAll(() => app.close());

    const api = () => request(app.getHttpServer());
    const auth = () => ({ Authorization: `Bearer ${token}` });

    it('requires authentication', async () => {
        await api().get('/v1/tickets').expect(401);
    });

    it('opens, reads and closes a ticket', async () => {
        const opened = await api()
            .post('/v1/tickets')
            .set(auth())
            .send({ title: 'Printer' })
            .expect(201);
        const id = (opened.body as { data: { id: string } }).data.id;

        await api().get(`/v1/tickets/${id}`).set(auth()).expect(200);
        await api().post(`/v1/tickets/${id}/close`).set(auth()).expect(200);
        await api().post(`/v1/tickets/${id}/close`).set(auth()).expect(409);
    });

    it('maps domain validation to 422 and bad input to 400', async () => {
        await api().post('/v1/tickets').set(auth()).send({ title: '   ' }).expect(422);
        await api().post('/v1/tickets').set(auth()).send({}).expect(400);
        await api().get('/v1/tickets/not-a-uuid').set(auth()).expect(400);
    });
});
```

Notes:

- Set env **before** `compile()`; config is validated when the module is built.
- `main.ts` isn't executed: enable versioning (and anything else you need from it) in the test.
- `@nestjs/jwt` is only used here to sign test tokens; the app verifies through passport-jwt.

## Real database

Unit and e2e tests don't touch Oracle. To check SQL against a real database:

```bash
docker run -d --name oracle -p 1521:1521 -e ORACLE_PASSWORD=pw gvenzl/oracle-free
# create tables, then in .env.development:
DATABASE_CONFIG_JSON='[{"key":"main","dialect":"oracle","connectString":"localhost:1521/FREEPDB1","user":"system","passwordEnv":"MAIN_DB_PASSWORD"}]'
MAIN_DB_PASSWORD=pw
pnpm start:dev
```

Then call the endpoints, and `GET /v1/database-info` to confirm `clientIdentifier` equals your username.
