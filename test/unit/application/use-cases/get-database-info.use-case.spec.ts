import type { DatabaseInfo, DatabaseInfoQueryPort, QueryOptions } from '@application/ports';
import { GetDatabaseInfoUseCase } from '@application/use-cases';

describe('GetDatabaseInfoUseCase', () => {
    const info: DatabaseInfo = {
        databaseName: 'FREEPDB1',
        sessionUser: 'APP',
        clientIdentifier: 'alice',
    };
    let calls: (QueryOptions | undefined)[];
    let sut: GetDatabaseInfoUseCase;

    beforeEach(() => {
        calls = [];
        const port: DatabaseInfoQueryPort = {
            getInfo: (options) => {
                calls.push(options);
                return Promise.resolve(info);
            },
        };
        sut = new GetDatabaseInfoUseCase(port);
    });

    it('returns the database info read as the acting user', async () => {
        // Arrange
        const input = { username: 'alice' };

        // Act
        const result = await sut.execute(input);

        // Assert
        expect(result).toEqual({ ok: true, value: info });
        expect(calls).toEqual([{ actor: 'alice' }]);
    });
});
