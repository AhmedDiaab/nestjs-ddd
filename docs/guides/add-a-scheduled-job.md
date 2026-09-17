# Add a scheduled job (cron)

For work that runs on a schedule instead of on a request: nightly clean-ups, reminders, syncs.

A job is a **delivery mechanism**, like a controller: it decides _when_, not _what_. The work itself stays in a use case.

| Piece               | Location                                                         |
| ------------------- | ---------------------------------------------------------------- |
| Job class           | `src/interface/scheduler/jobs/<name>.job.ts`                     |
| Registration        | the `jobs` list in `src/interface/scheduler/scheduler.module.ts` |
| Switch and timezone | `SCHEDULER_ENABLED`, `SCHEDULER_TIMEZONE`                        |

## 1. Write the job

```ts
// src/interface/scheduler/jobs/close-stale-tickets.job.ts
import { CloseTicketsUseCase } from '@application/use-cases';
import type { ScheduledJob } from '@interface/scheduler';
import { Injectable } from '@nestjs/common';

@Injectable()
export class CloseStaleTicketsJob implements ScheduledJob {
    readonly name = 'tickets.closeStale';
    readonly cronTime = '0 2 * * *'; // 02:00 every day, in SCHEDULER_TIMEZONE

    constructor(private readonly closeTickets: CloseTicketsUseCase) {}

    async run(): Promise<void> {
        const result = await this.closeTickets.execute({
            ids: await staleIds(),
            username: 'scheduler',
        });
        if (!result.ok) throw result.error; // logged as scheduler.job.failed
    }
}
```

- **Name**: unique and dotted; it appears in logs and in Nest's `SchedulerRegistry`.
- **`cronTime`**: 5 or 6 fields (`second minute hour day month weekday` when 6). Keep it a constant in the class, not an env variable, unless operators really need to change it.
- **The actor** for database writes is your service, not a person: pass a fixed username (`'scheduler'`) so Oracle's `CLIENT_IDENTIFIER` shows who did it.
- **Do the work in a use case**; the job only collects input and reports failure.

## 2. Register it

```ts
// src/interface/scheduler/scheduler.module.ts
const jobs: (new (...args: never[]) => ScheduledJob)[] = [CloseStaleTicketsJob];
```

Add the class to that list (it is both the provider list and the job list) and export it from `jobs/index.ts`.

## 3. Turn it on

```bash
SCHEDULER_ENABLED=true
SCHEDULER_TIMEZONE=Africa/Cairo   # default UTC
```

Off by default on purpose: **every instance with it on runs every job**. With several instances behind a load balancer, enable it on exactly one (see [Operations → Scheduled jobs](../architecture/operations.md#scheduled-jobs)).

## What the runner does for you

| Behaviour                                                                                     | Why                                   |
| --------------------------------------------------------------------------------------------- | ------------------------------------- |
| A throwing job is caught and logged as `scheduler.job.failed`                                 | one bad run must not kill the process |
| A run is skipped while the previous one is still going (`scheduler.job.skipped`)              | a slow job doesn't pile up            |
| Start, duration and next run are logged (`scheduler.job.scheduled`, `scheduler.job.finished`) | you can see whether it ran            |

## Rules

- **Make runs idempotent.** A job can run twice: after a restart, or when two instances have the scheduler on by mistake.
- **Keep them short.** Long jobs block their own next run; for heavy work, process in batches and let the next run continue.
- **No HTTP concerns**: no envelope, no HTTP errors. Throw and let it be logged.
- **Shutdown**: a run in progress is not awaited on SIGTERM. Write jobs so an interrupted run can be repeated safely.
- **One job per file**, named `<name>.job.ts` ([decision 0008](../decisions/0008-one-thing-per-file.md)).

## Test it

- **The job**: unit-test `run()` with a fake or stubbed use case; assert what it passes and that failures throw.
- **The wiring**: `JobRunner` and `JobScheduler` are already covered in `test/unit/interface/scheduler` (failures swallowed, overlapping runs skipped, jobs registered only when enabled).
- Don't test cron expressions by waiting: call `run()` directly.
