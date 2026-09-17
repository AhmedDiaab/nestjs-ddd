import { NotFoundError } from '@application/errors';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { DatabaseUnitOfWork } from '@infrastructure/database/unit-of-work';
import { Result } from '@shared';

/** Stands in for PoolManager.runInTransaction: records whether the transaction committed. */
function fakeProvider() {
    const outcome: { committed: boolean; rolledBack: boolean; options?: unknown } = {
        committed: false,
        rolledBack: false,
    };
    const db = {
        runInTransaction: async (_key: string, work: () => Promise<unknown>, options?: unknown) => {
            outcome.options = options;
            try {
                const value = await work();
                outcome.committed = true;
                return value;
            } catch (e) {
                outcome.rolledBack = true;
                throw e;
            }
        },
    };
    return { db: db as unknown as ConnectionProvider, outcome };
}

describe('DatabaseUnitOfWork', () => {
    it('commits and returns the work result', async () => {
        // Arrange
        const { db, outcome } = fakeProvider();
        const sut = new DatabaseUnitOfWork(db);

        // Act
        const result = await sut.run(() => Promise.resolve(Result.ok('saved')), { actor: 'alice' });

        // Assert
        expect(result).toEqual(Result.ok('saved'));
        expect(outcome).toMatchObject({
            committed: true,
            rolledBack: false,
            options: { contextUser: 'alice', tag: 'unitOfWork.run' },
        });
    });

    it('rolls back on a failed Result and returns it as a value', async () => {
        // Arrange
        const { db, outcome } = fakeProvider();
        const sut = new DatabaseUnitOfWork(db);
        const failure = Result.err(new NotFoundError('Ticket not found'));

        // Act
        const result = await sut.run(() => Promise.resolve(failure));

        // Assert
        expect(result).toBe(failure);
        expect(outcome).toMatchObject({ committed: false, rolledBack: true });
    });

    it('rolls back and rethrows unexpected errors', async () => {
        // Arrange
        const { db, outcome } = fakeProvider();
        const sut = new DatabaseUnitOfWork(db);

        // Act
        const run = sut.run(() => Promise.reject(new Error('db down')));

        // Assert
        await expect(run).rejects.toThrow('db down');
        expect(outcome.rolledBack).toBe(true);
    });
});
