import type { UnitOfWorkOptions, UnitOfWorkPort } from '@application/ports';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { DatabaseSources } from '@infrastructure/database/sources';
import { isResultLike } from '@shared';
import { RollbackWithResult } from './rollback-with-result.error';

/**
 * UnitOfWorkPort over one transaction on the main source. Repository and DAO calls made inside
 * `work` join it through ConnectionProvider, so they need no changes.
 */
export class DatabaseUnitOfWork implements UnitOfWorkPort {
    constructor(private readonly db: ConnectionProvider) {}

    async run<T>(work: () => Promise<T>, options?: UnitOfWorkOptions): Promise<T> {
        try {
            return await this.db.runInTransaction(
                DatabaseSources.main,
                async () => {
                    const result = await work();
                    if (isResultLike(result) && !result.ok) throw new RollbackWithResult(result);
                    return result;
                },
                { contextUser: options?.actor, tag: 'unitOfWork.run' },
            );
        } catch (e) {
            if (e instanceof RollbackWithResult) return e.result as T;
            throw e;
        }
    }
}
