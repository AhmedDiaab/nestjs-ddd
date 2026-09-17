# Add a controller

Where:

| Piece        | Location                                                 |
| ------------ | -------------------------------------------------------- |
| Zod schemas  | `src/interface/http/schemas/<feature>.schema.ts`         |
| Controller   | `src/interface/http/controllers/<feature>.controller.ts` |
| Registration | `src/interface/interface.module.ts`                      |

Background: [HTTP interface](../architecture/http-interface.md).

## 1. Schemas

```ts
// src/interface/http/schemas/ticket.schema.ts
import { z } from 'zod';
import { OffsetQuerySchema } from './pagination.schema';

export const openTicketBodySchema = z.object({
    title: z.string(), // business rules (trim, length) live in the TicketTitle value object
});
export type OpenTicketBody = z.infer<typeof openTicketBodySchema>;

export const ticketIdParamsSchema = z.object({
    id: z.uuid(),
});
export type TicketIdParams = z.infer<typeof ticketIdParamsSchema>;

export const listTicketsQuerySchema = OffsetQuerySchema.extend({
    status: z.enum(['open', 'closed']).optional(),
    orderBy: z
        .enum(['createdAt:desc', 'createdAt:asc', 'title:asc', 'title:desc'])
        .default('createdAt:desc'),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;
```

Export them from `src/interface/http/schemas/index.ts`.

- HTTP schemas check **structure**: types, formats (`z.uuid()`), enums, numeric ranges. On failure the response is **400**.
- Business rules stay in the domain (422). Avoid duplicating them here.
- `OffsetQuerySchema` gives `page` (≥1, default 1) and `size` (1–100, default 20), coerced from query strings.

## 2. Controller

```ts
// src/interface/http/controllers/tickets.controller.ts
import {
    CloseTicketUseCase,
    GetTicketUseCase,
    ListTicketsUseCase,
    OpenTicketUseCase,
} from '@application/use-cases';
import type { JWTPayload } from '@domain/auth';
import { CurrentUser, UseZodHttp, Validated } from '@interface/http/decorators';
import { JwtGuard } from '@interface/http/guards';
import {
    listTicketsQuerySchema,
    openTicketBodySchema,
    ticketIdParamsSchema,
    type ListTicketsQuery,
    type OpenTicketBody,
    type TicketIdParams,
} from '@interface/http/schemas';
import { Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BEARER_SECURITY } from '../swagger/swagger.constants';

/**
 * Thin controller: validate input, pass the authenticated user down, return the use-case Result.
 * ResponseFormatterInterceptor turns Result.ok into { success, data, meta } and
 * Result.err into the HTTP status of the error (404, 409, 422...).
 */
@ApiTags('tickets')
@ApiBearerAuth(BEARER_SECURITY)
@UseGuards(JwtGuard)
@Controller('tickets')
export class TicketsController {
    constructor(
        private readonly openTicket: OpenTicketUseCase,
        private readonly closeTicket: CloseTicketUseCase,
        private readonly getTicket: GetTicketUseCase,
        private readonly listTickets: ListTicketsUseCase,
    ) {}

    @Post()
    @UseZodHttp({ body: openTicketBodySchema })
    open(@Validated('body') body: OpenTicketBody, @CurrentUser() user: JWTPayload) {
        return this.openTicket.execute({ title: body.title, username: user.username });
    }

    @Get()
    @UseZodHttp({ query: listTicketsQuerySchema })
    list(@Validated('query') query: ListTicketsQuery, @CurrentUser() user: JWTPayload) {
        return this.listTickets.execute({
            filter: { status: query.status },
            page: { page: query.page, size: query.size, orderBy: query.orderBy },
            username: user.username,
        });
    }

    @Get(':id')
    @UseZodHttp({ params: ticketIdParamsSchema })
    get(@Validated('params') params: TicketIdParams, @CurrentUser() user: JWTPayload) {
        return this.getTicket.execute({ id: params.id, username: user.username });
    }

    @Post(':id/close')
    @HttpCode(HttpStatus.OK)
    @UseZodHttp({ params: ticketIdParamsSchema })
    close(@Validated('params') params: TicketIdParams, @CurrentUser() user: JWTPayload) {
        return this.closeTicket.execute({ id: params.id, username: user.username });
    }
}
```

Export it from `src/interface/http/controllers/index.ts`.

Resulting responses:

| Request                                | Status        | Body                                                |
| -------------------------------------- | ------------- | --------------------------------------------------- |
| `POST /v1/tickets {"title":"Printer"}` | 201           | `{ success: true, data: { id }, meta }`             |
| `POST /v1/tickets {"title":"  "}`      | 422           | `error.details: { title: "Title is required" }`     |
| `POST /v1/tickets {}`                  | 400           | `error.details: ["body.title: ..."]`                |
| `GET /v1/tickets/not-a-uuid`           | 400           |                                                     |
| `GET /v1/tickets/<unknown uuid>`       | 404           |                                                     |
| `POST /v1/tickets/<id>/close` (twice)  | 200, then 409 |                                                     |
| `GET /v1/tickets?status=open&size=10`  | 200           | `data: { data: [...], meta: { hasNext, hasPrev } }` |
| no/invalid token                       | 401           |                                                     |

## 3. Register

```ts
// src/interface/interface.module.ts
controllers: [HealthController, DatabaseInfoController, TicketsController, FallbackController],
```

`FallbackController` must remain **last**, or its catch-all route swallows yours.

## Rules

- Controllers do three things: validate (`@UseZodHttp`), extract (`@Validated`, `@CurrentUser`), call one use case. No business logic, no ports, no try/catch.
- Return the use case's `Result` directly; don't unwrap it or throw `HttpException`s for business failures.
- Always pass `user.username` so the database sees who acted.
- POST that doesn't create a resource: add `@HttpCode(HttpStatus.OK)`.
- Public route on a guarded controller: put `@UseGuards(JwtGuard)` on methods instead of the class.
- Guards that read request data: validate with `readGuardInput(context, 'params', schema)` and throw `ForbiddenError`/`UnauthorizedError`.
- Swagger: `@ApiTags`, security decorators, and `@ApiOkResponse({ type })` when you need typed response docs.
- Versioned change: `@Controller({ path: 'tickets', version: '2' })`.

Tests: [Write tests → HTTP](write-tests.md#http-end-to-end).
