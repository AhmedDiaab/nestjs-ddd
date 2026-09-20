import { clusterSchema } from '@infrastructure/config/schemas';

describe('clusterSchema', () => {
    it('defaults to disabled, one worker per CPU, respawn on', () => {
        // Arrange
        const input = {};

        // Act
        const parsed = clusterSchema.parse(input);

        // Assert
        expect(parsed).toMatchObject({
            enabled: false,
            workers: 0,
            respawn: true,
            respawnMaxPerMinute: 10,
            isLeader: false,
        });
        expect(parsed.metricsPort).toBeUndefined();
    });

    it('coerces numeric env strings', () => {
        // Arrange
        const input = { workers: '4', respawnMaxPerMinute: '20', metricsPort: '9091' };

        // Act
        const parsed = clusterSchema.parse(input);

        // Assert
        expect(parsed).toMatchObject({ workers: 4, respawnMaxPerMinute: 20, metricsPort: 9091 });
    });

    it('rejects a negative worker count', () => {
        // Arrange
        const input = { workers: -1 };

        // Act
        const result = clusterSchema.safeParse(input);

        // Assert
        expect(result.success).toBe(false);
    });

    it('rejects a metrics port outside the valid TCP range', () => {
        // Arrange
        const input = { metricsPort: 70000 };

        // Act
        const result = clusterSchema.safeParse(input);

        // Assert
        expect(result.success).toBe(false);
    });

    it('rejects a respawn cap below 1', () => {
        // Arrange
        const input = { respawnMaxPerMinute: 0 };

        // Act
        const result = clusterSchema.safeParse(input);

        // Assert
        expect(result.success).toBe(false);
    });
});
