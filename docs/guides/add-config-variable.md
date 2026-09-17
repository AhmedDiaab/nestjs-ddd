# Add a config variable

Example: a `tickets` section with `TICKETS_MAX_PAGE_SIZE` and `TICKETS_ALLOW_CLOSE_BY_OTHERS`.

Background: [Configuration](../architecture/configuration.md).

## 1. Schema

```ts
// src/infrastructure/config/schemas/tickets.schema.ts
import { z } from 'zod';

export const ticketsSchema = z.object({
    /** Upper bound for GET /tickets?size= */
    maxPageSize: z.coerce.number().int().min(1).max(500).default(100),
    /** Allow closing tickets opened by other users */
    allowCloseByOthers: z.boolean().default(true),
});

export type TicketsConfig = z.infer<typeof ticketsSchema>;
```

```ts
// src/infrastructure/config/schemas/index.ts
export { type TicketsConfig, ticketsSchema } from './tickets.schema';
```

- Numbers: `z.coerce.number()` (env values are strings).
- Booleans: `z.boolean()`, fed by `envBool` (it already converts).
- Lists: `z.array(...)`, fed by `envList`.
- Secrets: `z.string().min(n)`, no default.
- Required values: no `.default()` and no `.optional()`.

## 2. Hydrate from env

```ts
// src/infrastructure/config/env-config.adapter.ts
import { /* ... */ ticketsSchema } from '@infrastructure/config/schemas';

const rootSchema = z.object({
    // ...
    jwt: jwtSchema,
    tickets: ticketsSchema,
});

function hydrate() {
    return {
        // ...
        tickets: {
            maxPageSize: envString(env.TICKETS_MAX_PAGE_SIZE),
            allowCloseByOthers: envBool(env.TICKETS_ALLOW_CLOSE_BY_OTHERS),
        },
        // ...
    };
}
```

Always wrap with `envString`/`envBool`/`envList`. They turn blank values into `undefined`, so defaults apply. (A plain `env.X === 'true'` makes an unset flag `false`, silently skipping the default.)

## 3. Document

- `.env.example`: add the variables with a comment showing the default.
- `docs/architecture/configuration.md`: add a table section.
- Local `.env.development` if you need a non-default value.

## 4. Read it

```ts
constructor(@Inject(ConfigPortToken) private readonly config: ConfigPort) {}

const maxPageSize = this.config.get<number>('tickets.maxPageSize')!;
```

- In a **use case**: inject `ConfigPortToken`. Config is a port, so this is allowed.
- In **interface schemas**: Zod schemas are module-level constants and can't inject config. Keep structural limits in the schema and enforce configurable limits in the use case.
- Read values once in the constructor if they're used on every call.

## 5. Test

```ts
// test/unit/infrastructure/config/env-config.adapter.spec.ts
it('loads the tickets section with defaults', () => {
    // Arrange: only BASE_ENV is set

    // Act
    const config = loadConfig();

    // Assert
    expect(config.tickets).toEqual({ maxPageSize: 100, allowCloseByOthers: true });
});

it('loads the tickets section overrides', () => {
    // Arrange
    process.env = {
        ...BASE_ENV,
        TICKETS_MAX_PAGE_SIZE: '50',
        TICKETS_ALLOW_CLOSE_BY_OTHERS: 'false',
    };

    // Act
    const config = loadConfig();

    // Assert
    expect(config.tickets).toEqual({ maxPageSize: 50, allowCloseByOthers: false });
});
```

Invalid values fail startup with `❌ Invalid configuration: tickets.maxPageSize: ...` and exit code 1.
