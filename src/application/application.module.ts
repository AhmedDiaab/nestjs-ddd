import { GetDatabaseInfoUseCase } from '@application/use-cases';
import { Module } from '@nestjs/common';

/**
 * Use cases only. Port implementations come from global infrastructure modules
 * wired in the composition root (`AppModule`), never imported here.
 */
@Module({
    providers: [GetDatabaseInfoUseCase],
    exports: [GetDatabaseInfoUseCase],
})
export class ApplicationModule {}
