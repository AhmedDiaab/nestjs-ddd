import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { PinoLoggerModule } from './logging/pino.module';

@Module({
    imports: [ConfigModule, PinoLoggerModule],
    providers: [],
    exports: [ConfigModule, PinoLoggerModule],
})
export class InfrastructureModule {}
