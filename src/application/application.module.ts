import {
    DomainEventHandlersToken,
    InProcessDomainEventPublisher,
    type DomainEventHandler,
} from '@application/events';
import {
    DomainEventPublisherPortToken,
    LoggerPortToken,
    type LoggerPort,
} from '@application/ports';
import { GetDatabaseInfoUseCase } from '@application/use-cases';
import { ProviderFactory } from '@common/factories';
import { Module } from '@nestjs/common';

/** Event handler classes; add each new handler here (they are also listed in `providers`). */
const eventHandlers: (new (...args: never[]) => DomainEventHandler)[] = [];

/**
 * Use cases and in-process event handling. Port implementations come from global
 * infrastructure modules wired in the composition root (`AppModule`), never imported here.
 */
@Module({
    providers: [
        GetDatabaseInfoUseCase,
        ...eventHandlers,
        ProviderFactory.factory(
            DomainEventHandlersToken,
            (...handlers: DomainEventHandler[]) => handlers,
            eventHandlers,
        ),
        ProviderFactory.factory(
            DomainEventPublisherPortToken,
            (handlers: readonly DomainEventHandler[], logger: LoggerPort) =>
                new InProcessDomainEventPublisher(handlers, logger),
            [DomainEventHandlersToken, LoggerPortToken],
        ),
    ],
    exports: [GetDatabaseInfoUseCase, DomainEventPublisherPortToken],
})
export class ApplicationModule {}
