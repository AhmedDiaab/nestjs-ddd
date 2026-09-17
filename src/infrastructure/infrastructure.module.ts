import { AuthModule } from '@infrastructure/auth/auth.module';
import { ConfigModule } from '@infrastructure/config';
import { DatabaseModule } from '@infrastructure/database';
import { PinoLoggerModule } from '@infrastructure/logging';
import { Module } from '@nestjs/common';

/** Port implementations. Config, logging and database modules are global. */
@Module({
    imports: [ConfigModule, PinoLoggerModule, DatabaseModule, AuthModule],
    exports: [ConfigModule, PinoLoggerModule, DatabaseModule, AuthModule],
})
export class InfrastructureModule {}
