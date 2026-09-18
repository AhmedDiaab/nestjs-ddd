import {
    DatabaseHealthPortToken,
    DatabaseInfoQueryPortToken,
    UnitOfWorkPortToken,
} from '@application/ports';
import { ProviderFactory } from '@common/factories';
import {
    ConnectionProvider,
    ConnectionProviderToken,
    PoolManager,
} from '@infrastructure/database/connection';
import type { ConnectionProvider as IConnectionProvider } from '@infrastructure/database/contracts';
import { PoolHealthAdapter } from '@infrastructure/database/health';
import { DatabaseInfoQueryDao } from '@infrastructure/database/queries';
import { DatabaseUnitOfWork } from '@infrastructure/database/unit-of-work';
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
        ProviderFactory.factory(
            UnitOfWorkPortToken,
            (db: IConnectionProvider) => new DatabaseUnitOfWork(db),
            [ConnectionProviderToken],
        ),
        ProviderFactory.factory(
            DatabaseHealthPortToken,
            (db: IConnectionProvider) => new PoolHealthAdapter(db),
            [ConnectionProviderToken],
        ),
    ],
    exports: [
        ConnectionProviderToken,
        DatabaseInfoQueryPortToken,
        UnitOfWorkPortToken,
        DatabaseHealthPortToken,
    ],
})
export class DatabaseModule {}
