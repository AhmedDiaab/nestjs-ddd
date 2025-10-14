import type { ConfigPort } from '@application/ports/config.port';
import { ProviderFactory } from '@common/factories/provider.factory';
import { ConfigPortToken } from '@infrastructure/config/config.token';
import { Global, Module } from '@nestjs/common';
import { LoggerModule, type Params } from 'nestjs-pino';
import { LoggerPortToken } from './logging.token';
import { PinoLoggerAdapter } from './pino.adapter';
import { generatePinoOptions } from './pino.options';

@Global()
@Module({
    imports: [
        LoggerModule.forRootAsync({
            inject: [ConfigPortToken],
            useFactory: (config: ConfigPort): Params => generatePinoOptions(config),
        }),
    ],
    providers: [ProviderFactory.create(LoggerPortToken, PinoLoggerAdapter)],
    exports: [LoggerPortToken],
})
export class PinoLoggerModule {}
