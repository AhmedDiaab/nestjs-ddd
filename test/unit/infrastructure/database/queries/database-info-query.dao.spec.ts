import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { DatabaseInfoQueryDao } from '@infrastructure/database/queries';
import oracledb from 'oracledb';

describe('DatabaseInfoQueryDao', () => {
    const connection = { execute: jest.fn() };
    const db = {
        withConnection: jest.fn((_key: string, fn: (c: unknown) => Promise<unknown>) =>
            fn(connection),
        ),
    };
    const sut = new DatabaseInfoQueryDao(db as unknown as ConnectionProvider);

    afterEach(() => jest.clearAllMocks());

    it('maps named columns and passes the actor as context user', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({
            rows: [{ DATABASE_NAME: 'FREEPDB1', SESSION_USER: 'APP', CLIENT_IDENTIFIER: 'alice' }],
        });

        // Act
        const info = await sut.getInfo({ actor: 'alice' });

        // Assert
        expect(info).toEqual({
            databaseName: 'FREEPDB1',
            sessionUser: 'APP',
            clientIdentifier: 'alice',
        });
        expect(db.withConnection).toHaveBeenCalledWith('main', expect.any(Function), {
            contextUser: 'alice',
            tag: 'databaseInfo.getInfo',
        });
        expect(connection.execute).toHaveBeenCalledWith(
            expect.stringContaining("SYS_CONTEXT('USERENV', 'CLIENT_IDENTIFIER')"),
            {},
            { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
    });

    it('runs without a context user when no actor is given', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({
            rows: [{ DATABASE_NAME: 'FREEPDB1', SESSION_USER: 'APP', CLIENT_IDENTIFIER: null }],
        });

        // Act
        const info = await sut.getInfo();

        // Assert
        expect(info.clientIdentifier).toBeNull();
        expect(db.withConnection).toHaveBeenCalledWith('main', expect.any(Function), {
            contextUser: undefined,
            tag: 'databaseInfo.getInfo',
        });
    });
});
