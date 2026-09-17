# Write tests

Background: [Testing](../architecture/testing.md). Run `pnpm test`, `pnpm test:e2e`, and `pnpm typecheck` (Jest doesn't type-check).

Files mirror `src`: `src/domain/tickets/ticket.entity.ts` → `test/unit/domain/tickets/ticket.entity.spec.ts`.

Every test follows **Arrange-Act-Assert**, marked with comments and separated by blank lines:

```ts
it('refuses to close twice', () => {
    // Arrange
    const ticket = open();
    ticket.close('bob', now);

    // Act
    const second = ticket.close('bob', now);

    // Assert
    expect(!second.ok && second.error).toBeInstanceOf(TicketAlreadyClosedError);
});
```

- One Act per test (one call to the unit under test). Setting up earlier state belongs in Arrange.
- Shared setup in `beforeEach` counts as Arrange; the test keeps only what is specific to it.
- For a rejected promise, keep the call in Act (`const call = sut.run()`) and `await expect(call).rejects…` in Assert.
- When setup already happened (in `beforeEach`, or the input comes from an `it.each` table), keep the marker with a note: `// Arrange: ticket opened in beforeEach`.
- Several inputs for one behaviour: use `it.each` so each case still has one Act.

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
    it('trims the value', () => {
        // Arrange
        const raw = '  Printer  ';

        // Act
        const result = TicketTitle.create(raw);

        // Assert
        expect(result.ok && result.value.value).toBe('Printer');
    });

    it.each(['', '   ', 'x'.repeat(TicketTitle.MAX_LENGTH + 1)])('rejects %p', (raw) => {
        // Arrange: raw from table

        // Act
        const result = TicketTitle.create(raw);

        // Assert
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toBeInstanceOf(ValidationError);
    });

    it('compares by value', () => {
        // Arrange
        const a = title('A');
        const trimmedA = title(' A ');

        // Act
        const equal = a.equals(trimmedA);

        // Assert
        expect(equal).toBe(true);
    });
});

describe('Ticket', () => {
    const now = new Date('2026-01-01T10:00:00Z');
    const open = () => Ticket.open({ id: 't-1', title: title(), createdBy: 'alice', now });

    it('opens with status open and no events', () => {
        // Arrange
        const input = { id: 't-1', title: title(), createdBy: 'alice', now };

        // Act
        const ticket = Ticket.open(input);

        // Assert
        expect(ticket.status).toBe('open');
        expect(ticket.pullEvents()).toEqual([]);
    });

    it('closes once and records TicketClosed', () => {
        // Arrange
        const ticket = open();
        const later = new Date('2026-01-02T10:00:00Z');

        // Act
        const result = ticket.close('bob', later);

        // Assert
        expect(result.ok).toBe(true);
        expect(ticket.status).toBe('closed');
        expect(ticket.closedAt).toEqual(later);
        expect(ticket.pullEvents()).toEqual([
            { name: 'TicketClosed', occurredAt: later, ticketId: 't-1', closedBy: 'bob' },
        ]);
    });

    it('refuses to close twice', () => {
        // Arrange
        const ticket = open();
        ticket.close('bob', now);

        // Act
        const second = ticket.close('bob', now);

        // Assert
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

    const openExisting = async () => {
        const opened = await openTicket.execute({ title: 'Printer', username: 'alice' });
        return opened.ok ? opened.value.id : '';
    };

    it('opens a ticket and saves it as the acting user', async () => {
        // Arrange
        const input = { title: 'Printer', username: 'alice' };

        // Act
        const result = await openTicket.execute(input);

        // Assert
        expect(result.ok).toBe(true);
        const id = result.ok ? result.value.id : '';
        expect(tickets.store.get(id)?.createdBy).toBe('alice');
        expect(tickets.actors).toEqual(['alice']);
    });

    it('returns a ValidationError for an empty title without saving', async () => {
        // Arrange
        const input = { title: ' ', username: 'alice' };

        // Act
        const result = await openTicket.execute(input);

        // Assert
        expect(!result.ok && result.error).toBeInstanceOf(ValidationError);
        expect(tickets.store.size).toBe(0);
    });

    it('closes an open ticket', async () => {
        // Arrange
        const id = await openExisting();

        // Act
        const result = await closeTicket.execute({ id, username: 'bob' });

        // Assert
        expect(result).toEqual({ ok: true, value: { id, status: 'closed' } });
        expect(tickets.store.get(id)?.status).toBe('closed');
    });

    it('returns NotFoundError for an unknown ticket', async () => {
        // Arrange
        const input = { id: 'missing', username: 'bob' };

        // Act
        const result = await closeTicket.execute(input);

        // Assert
        expect(!result.ok && result.error).toBeInstanceOf(NotFoundError);
    });

    it('returns TicketAlreadyClosedError when closing twice', async () => {
        // Arrange
        const id = await openExisting();
        await closeTicket.execute({ id, username: 'bob' });

        // Act
        const result = await closeTicket.execute({ id, username: 'bob' });

        // Assert
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
import { OracleTicketRepository } from '@infrastructure/database/repositories';

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
        // Arrange
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

        // Act
        const ticket = await sut.findById('t-1', { actor: 'bob' });

        // Assert
        expect(ticket).toBeInstanceOf(Ticket);
        expect(ticket?.title.value).toBe('Printer');
        expect(db.withConnection).toHaveBeenCalledWith('main', expect.any(Function), {
            contextUser: 'bob',
            tag: 'tickets.findById',
        });
    });

    it('returns undefined when no row matches', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({ rows: [] });

        // Act
        const ticket = await sut.findById('missing');

        // Assert
        expect(ticket).toBeUndefined();
    });

    it('saves inside a transaction with bind values from the aggregate', async () => {
        // Arrange
        const title = TicketTitle.create('Printer');
        if (!title.ok) throw title.error;
        const ticket = Ticket.open({
            id: 't-1',
            title: title.value,
            createdBy: 'alice',
            now: new Date('2026-01-01T00:00:00Z'),
        });

        // Act
        await sut.save(ticket, { actor: 'alice' });

        // Assert
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
    // Arrange
    connection.execute.mockResolvedValueOnce({ rows: [row('1'), row('2'), row('3')] });
    const pageRequest = { page: 2, size: 2, orderBy: 'title:asc' } as const;

    // Act
    const page = await sut.list({}, pageRequest, { actor: 'bob' });

    // Assert
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
    const auth = { Authorization: '' };
    beforeEach(() => {
        auth.Authorization = `Bearer ${token}`;
        tickets.store.clear();
    });

    const openTicket = async (title = 'Printer') => {
        const res = await api().post('/v1/tickets').set(auth).send({ title }).expect(201);
        return (res.body as { data: { id: string } }).data.id;
    };

    it('requires authentication', async () => {
        // Arrange: no Authorization header

        // Act
        const res = await api().get('/v1/tickets');

        // Assert
        expect(res.status).toBe(401);
    });

    it('opens a ticket', async () => {
        // Arrange
        const body = { title: 'Printer' };

        // Act
        const res = await api().post('/v1/tickets').set(auth).send(body);

        // Assert
        expect(res.status).toBe(201);
        const { success, data } = res.body as { success: boolean; data: { id: string } };
        expect(success).toBe(true);
        expect(tickets.store.has(data.id)).toBe(true);
    });

    it('reads a ticket', async () => {
        // Arrange
        const id = await openTicket();

        // Act
        const res = await api().get(`/v1/tickets/${id}`).set(auth);

        // Assert
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            data: { id, status: 'open', createdBy: 'alice' },
        });
    });

    it('lists tickets by status', async () => {
        // Arrange
        const id = await openTicket();

        // Act
        const res = await api().get('/v1/tickets?status=open&size=10').set(auth);

        // Assert
        expect(res.status).toBe(200);
        const listed = (res.body as { data: { data: { id: string }[] } }).data.data;
        expect(listed.map((t) => t.id)).toEqual([id]);
    });

    it('closes a ticket', async () => {
        // Arrange
        const id = await openTicket();

        // Act
        const res = await api().post(`/v1/tickets/${id}/close`).set(auth);

        // Assert
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, data: { id, status: 'closed' } });
    });

    it('returns 409 when closing a closed ticket', async () => {
        // Arrange
        const id = await openTicket();
        await api().post(`/v1/tickets/${id}/close`).set(auth).expect(200);

        // Act
        const res = await api().post(`/v1/tickets/${id}/close`).set(auth);

        // Assert
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false });
    });

    it.each([
        ['a blank title (domain validation)', 'post', '/v1/tickets', { title: '   ' }, 422],
        ['a missing title (schema validation)', 'post', '/v1/tickets', {}, 400],
        ['a malformed id', 'get', '/v1/tickets/not-a-uuid', undefined, 400],
        [
            'an unknown ticket',
            'get',
            '/v1/tickets/3f2c3c0e-8c1c-4a55-9a6f-2a0b8f7d9c11',
            undefined,
            404,
        ],
    ] as const)('returns the right status for %s', async (_case, method, path, body, status) => {
        // Arrange
        const call = method === 'post' ? api().post(path).send(body) : api().get(path);

        // Act
        const res = await call.set(auth);

        // Assert
        expect(res.status).toBe(status);
    });
});
```

Notes:

- Set env **before** `compile()`; config is validated when the module is built.
- `main.ts` isn't executed: enable versioning (and anything else you need from it) in the test.
- `@nestjs/jwt` is only used here to sign test tokens; the app verifies through passport-jwt.

## Real database

Unit and e2e tests don't touch Oracle. The live suite in `test/integration` runs `OracleClient` against a real database (see [Testing › Live Oracle tests](../architecture/testing.md#live-oracle-tests)):

```bash
docker compose --env-file .env.docker up -d oracle
ORACLE_IT_PASSWORD=<app user password> pnpm test:oracle
```

Add feature SQL checks there as `*.int-spec.ts` (create and drop their own tables). To try endpoints manually, point `.env.development` at the same database:

```bash
DATABASE_CONFIG_JSON='[{"key":"main","dialect":"oracle","connectString":"localhost:1521/FREEPDB1","user":"app","passwordEnv":"MAIN_DB_PASSWORD"}]'
MAIN_DB_PASSWORD=<app user password>
pnpm start:dev
```

Then call the endpoints, and `GET /v1/database-info` to confirm `clientIdentifier` equals your username.
