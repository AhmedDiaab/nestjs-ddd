import { DatabaseInfoQueryPortToken } from '@application/ports';
import { ProviderFactory } from '@common/factories';
import {
    ConnectionProvider,
    ConnectionProviderToken,
    PoolManager,
} from '@infrastructure/database/connection';
import type { ConnectionProvider as IConnectionProvider } from '@infrastructure/database/contracts';
import { DatabaseInfoQueryDao } from '@infrastructure/database/queries';
import { Global, Module } from '@nestjs/common';

@Global()
@Module({
    providers: [
        PoolManager,
        ConnectionProvider,
        // DAOs depend on ConnectionProviderToken (not PoolManager) so pools are
        // created and pinged before any DAO is constructed
        ProviderFactory.factory(
            DatabaseInfoQueryPortToken,
            (db: IConnectionProvider) => new DatabaseInfoQueryDao(db),
            [ConnectionProviderToken],
        ),
    ],
    exports: [ConnectionProviderToken, DatabaseInfoQueryPortToken],
})
export class DatabaseModule {}
