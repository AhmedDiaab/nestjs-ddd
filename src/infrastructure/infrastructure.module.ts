import { AuthModule } from '@infrastructure/auth/auth.module';
import { ConfigModule } from '@infrastructure/config';
import { DatabaseModule } from '@infrastructure/database';
import { PinoLoggerModule } from '@infrastructure/logging';
import { ThrottlingModule } from '@infrastructure/throttling';
import { Module } from '@nestjs/common';

/** Port implementations. Config, logging, database and throttling modules are global. */
@Module({
    imports: [ConfigModule, PinoLoggerModule, DatabaseModule, AuthModule, ThrottlingModule],
    exports: [ConfigModule, PinoLoggerModule, DatabaseModule, AuthModule, ThrottlingModule],
})
export class InfrastructureModule {}
