import { DatabaseInfoRepositoryPortToken } from '@application/ports';
import { ProviderFactory } from '@common/factories';
import {
    ConnectionProvider,
    ConnectionProviderToken,
    PoolManager,
} from '@infrastructure/database/connection';
import type { ConnectionProvider as IConnectionProvider } from '@infrastructure/database/contracts';
import { DatabaseInfoDao } from '@infrastructure/database/dao';
import { Global, Module } from '@nestjs/common';

@Global()
@Module({
    providers: [
        PoolManager,
        ConnectionProvider,
        // DAOs depend on ConnectionProviderToken (not PoolManager) so pools are
        // created and pinged before any DAO is constructed
        ProviderFactory.factory(
            DatabaseInfoRepositoryPortToken,
            (db: IConnectionProvider) => new DatabaseInfoDao(db),
            [ConnectionProviderToken],
        ),
    ],
    exports: [ConnectionProviderToken, DatabaseInfoRepositoryPortToken],
})
export class DatabaseModule {}
