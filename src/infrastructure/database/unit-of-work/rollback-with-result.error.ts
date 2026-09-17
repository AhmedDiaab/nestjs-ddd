/** Carries a failed Result out of the transaction so it rolls back, then is returned as a value. */
export class RollbackWithResult extends Error {
    constructor(readonly result: unknown) {
        super('unit of work returned a failed Result');
        this.name = 'RollbackWithResult';
    }
}
