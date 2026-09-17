/**
 * Immutable, compared by value. Validate in a static `create` that returns a `Result`
 * so invalid values never exist (e.g. `SiteName.create('CEN_1234')`).
 */
export abstract class ValueObject<Props extends Record<string, unknown>> {
    protected readonly props: Readonly<Props>;

    protected constructor(props: Props) {
        this.props = Object.freeze({ ...props });
    }

    equals(other?: ValueObject<Props>): boolean {
        if (!other || other.constructor !== this.constructor) return false;
        return JSON.stringify(this.props) === JSON.stringify(other.props);
    }
}
