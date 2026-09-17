import { ShutdownState } from '@infrastructure/lifecycle';

describe('ShutdownState', () => {
    it('starts as running', () => {
        // Arrange
        const sut = new ShutdownState();

        // Act
        const draining = sut.isShuttingDown();

        // Assert
        expect(draining).toBe(false);
    });

    it('reports the first signal as the one that started the shutdown', () => {
        // Arrange
        const sut = new ShutdownState();

        // Act
        const started = sut.begin();

        // Assert
        expect(started).toBe(true);
        expect(sut.isShuttingDown()).toBe(true);
    });

    it('tells a second caller that a shutdown is already running', () => {
        // Arrange
        const sut = new ShutdownState();
        sut.begin();

        // Act
        const started = sut.begin();

        // Assert
        expect(started).toBe(false);
    });
});
