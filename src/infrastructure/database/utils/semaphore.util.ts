/** Simple concurrency limiter */
export class Semaphore {
    private count: number;
    private queue: (() => void)[] = [];
    constructor(max: number) {
        this.count = Math.max(1, max);
    }
    async with<T>(fn: () => Promise<T>): Promise<T> {
        if (this.count > 0) {
            this.count--;
            try {
                return await fn();
            } finally {
                this.count++;
                const n = this.queue.shift();
                if (n) n();
            }
        }
        await new Promise<void>((res) => this.queue.push(res));
        return this.with(fn);
    }
}
