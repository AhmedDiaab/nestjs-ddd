import { resolveWorkerCount } from '@infrastructure/cluster';

describe('resolveWorkerCount', () => {
    it('uses the configured worker count when it is greater than zero', () => {
        // Arrange
        const configured = 4;

        // Act
        const result = resolveWorkerCount(configured, 8);

        // Assert
        expect(result).toBe(4);
    });

    it('falls back to one worker per CPU core when configured as 0', () => {
        // Arrange
        const configured = 0;

        // Act
        const result = resolveWorkerCount(configured, 6);

        // Assert
        expect(result).toBe(6);
    });

    it('clamps to at least 1 worker even with a 0 CPU count', () => {
        // Arrange
        const configured = 0;

        // Act
        const result = resolveWorkerCount(configured, 0);

        // Assert
        expect(result).toBe(1);
    });

    it('floors a fractional CPU count', () => {
        // Arrange
        const configured = 0;

        // Act
        const result = resolveWorkerCount(configured, 3.7);

        // Assert
        expect(result).toBe(3);
    });

    it('clamps a negative configured count down to at least 1 worker', () => {
        // Arrange: the schema never produces a negative value, but the function stays safe anyway
        const configured = -5;

        // Act
        const result = resolveWorkerCount(configured, 4);

        // Assert
        expect(result).toBe(4);
    });
});
