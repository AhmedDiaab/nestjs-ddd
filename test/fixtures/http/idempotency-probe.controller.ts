import { setTimeout as delay } from 'node:timers/promises';
import { Idempotent, Public } from '@interface/http/decorators';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';

type CreateOrderBody = { total?: number; fail?: boolean };

/** Counts executions, so a test can tell a replay from a real re-run of the handler. */
@Public()
@Controller('e2e-idempotency')
export class IdempotencyProbeController {
    static executions = 0;
    /** Set to simulate a slow handler that is still running when a concurrent retry arrives. */
    static delayMs = 0;

    static reset(): void {
        IdempotencyProbeController.executions = 0;
        IdempotencyProbeController.delayMs = 0;
    }

    @Post()
    @Idempotent()
    @HttpCode(201)
    async create(@Body() body: CreateOrderBody) {
        IdempotencyProbeController.executions += 1;
        if (IdempotencyProbeController.delayMs > 0) {
            await delay(IdempotencyProbeController.delayMs);
        }
        if (body.fail) throw new Error('simulated handler failure');
        return { id: `order-${IdempotencyProbeController.executions}`, total: body.total };
    }
}
