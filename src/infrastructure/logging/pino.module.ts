import type { ConfigPort } from '@application/ports';
import { ProviderFactory } from '@common/factories';
import { ConfigPortToken } from '@infrastructure/config';
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
    providers: [ProviderFactory.class(LoggerPortToken, PinoLoggerAdapter)],
    exports: [LoggerPortToken],
})
export class PinoLoggerModule {}
