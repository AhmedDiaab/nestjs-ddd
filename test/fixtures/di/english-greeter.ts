export interface Greeter {
    greet(): string;
}

export class EnglishGreeter implements Greeter {
    constructor(private readonly name: string) {}

    greet() {
        return `hi ${this.name}`;
    }
}
