import { AuthModule } from '@infrastructure/auth/auth.module';
import { ConfigModule } from '@infrastructure/config';
import { ContextModule } from '@infrastructure/context';
import { DatabaseModule } from '@infrastructure/database';
import { HttpModule } from '@infrastructure/http';
import { LifecycleModule } from '@infrastructure/lifecycle';
import { PinoLoggerModule } from '@infrastructure/logging';
import { ThrottlingModule } from '@infrastructure/throttling';
import { Module } from '@nestjs/common';

/** Port implementations. Config, logging, database and throttling modules are global. */
@Module({
    imports: [
        ConfigModule,
        PinoLoggerModule,
        ContextModule,
        LifecycleModule,
        DatabaseModule,
        HttpModule,
        AuthModule,
        ThrottlingModule,
    ],
    exports: [
        ConfigModule,
        PinoLoggerModule,
        ContextModule,
        LifecycleModule,
        DatabaseModule,
        HttpModule,
        AuthModule,
        ThrottlingModule,
    ],
})
export class InfrastructureModule {}
