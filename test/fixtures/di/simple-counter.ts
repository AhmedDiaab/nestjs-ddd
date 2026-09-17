export interface Counter {
    count(): number;
}

export class SimpleCounter implements Counter {
    count() {
        return 1;
    }
}
