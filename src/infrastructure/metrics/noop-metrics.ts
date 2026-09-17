import type { MetricsPort } from '@application/ports';

/** Used when metrics are disabled: call sites stay unchanged and cost nothing. */
export class NoopMetrics implements MetricsPort {
    increment(): void {}
    observe(): void {}
    setGauge(): void {}
}
