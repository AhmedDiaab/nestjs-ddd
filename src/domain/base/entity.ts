/** Has identity: two entities are equal when their ids are equal. */
export abstract class Entity<Id, Props> {
    protected constructor(
        public readonly id: Id,
        protected props: Props,
    ) {}

    equals(other?: Entity<Id, Props>): boolean {
        if (!other || other.constructor !== this.constructor) return false;
        return this.id === other.id;
    }
}
