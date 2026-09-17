import { InProcessDomainEventPublisher, type DomainEventHandler } from '@application/events';
import type { LoggerPort } from '@application/ports';
import type { DomainEvent } from '@domain';

type Opened = DomainEvent & { name: 'Opened'; id: string };
type Closed = DomainEvent & { name: 'Closed'; id: string };

const at = new Date('2026-01-01T00:00:00Z');
const opened: Opened = { name: 'Opened', occurredAt: at, id: 't-1' };
const closed: Closed = { name: 'Closed', occurredAt: at, id: 't-1' };

function recordingHandler<E extends DomainEvent>(eventName: E['name'], calls: string[]) {
    const handler: DomainEventHandler<E> = {
        eventName,
        handle: (event) => {
            calls.push(`${eventName}:${event.name}`);
            return Promise.resolve();
        },
    };
    return handler as unknown as DomainEventHandler;
}

describe('InProcessDomainEventPublisher', () => {
    const error = jest.fn();
    const logger: LoggerPort = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error };

    afterEach(() => jest.clearAllMocks());

    it('dispatches each event to the handlers registered for its name, in order', async () => {
        // Arrange
        const calls: string[] = [];
        const sut = new InProcessDomainEventPublisher(
            [recordingHandler('Closed', calls), recordingHandler('Opened', calls)],
            logger,
        );

        // Act
        await sut.publish([opened, closed]);

        // Assert
        expect(calls).toEqual(['Opened:Opened', 'Closed:Closed']);
    });

    it('logs a failing handler and still runs the others', async () => {
        // Arrange
        const calls: string[] = [];
        const failing: DomainEventHandler = {
            eventName: 'Opened',
            handle: () => Promise.reject(new Error('mail server down')),
        };
        const sut = new InProcessDomainEventPublisher(
            [failing, recordingHandler('Opened', calls)],
            logger,
        );

        // Act
        const publish = sut.publish([opened]);

        // Assert
        await expect(publish).resolves.toBeUndefined();
        expect(calls).toEqual(['Opened:Opened']);
        expect(error).toHaveBeenCalledWith(
            'domain.event.handler.failed',
            expect.objectContaining({ event: 'Opened' }),
        );
    });

    it('ignores events nobody handles', async () => {
        // Arrange
        const sut = new InProcessDomainEventPublisher([], logger);

        // Act
        const publish = sut.publish([opened]);

        // Assert
        await expect(publish).resolves.toBeUndefined();
        expect(error).not.toHaveBeenCalled();
    });
});
