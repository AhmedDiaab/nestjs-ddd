import { createToken } from '@shared';

export type UnitOfWorkOptions = {
    /** Username for DB auditing (Oracle CLIENT_IDENTIFIER) for every write in the unit. */
    actor?: string;
};

/**
 * Makes several repository calls atomic without handing connections to use cases:
 *
 *     return this.unitOfWork.run(async () => {
 *         await this.tickets.save(ticket, { actor });
 *         await this.audit.save(entry, { actor });
 *         return Result.ok(ticket.id);
 *     }, { actor });
 *
 * Commits when `work` succeeds. Rolls back when `work` throws or returns a failed `Result`
 * (the failed result is returned to the caller, so expected failures stay values).
 */
export interface UnitOfWorkPort {
    run<T>(work: () => Promise<T>, options?: UnitOfWorkOptions): Promise<T>;
}

export const UnitOfWorkPortToken = createToken<UnitOfWorkPort>('UnitOfWorkPort');
