import { releaseWorkerChannel } from '@infrastructure/cluster';

describe('releaseWorkerChannel', () => {
    it('closes the IPC channel of a connected worker so it can exit on its own', () => {
        // Arrange
        const disconnect = jest.fn();
        const worker = { connected: true, disconnect };

        // Act
        releaseWorkerChannel(worker);

        // Assert
        expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('does nothing outside a cluster, where the process has no channel', () => {
        // Arrange
        const disconnect = jest.fn();
        const standalone = { connected: undefined, disconnect };

        // Act
        releaseWorkerChannel(standalone);

        // Assert
        expect(disconnect).not.toHaveBeenCalled();
    });

    it('tolerates a process that reports a channel but cannot disconnect', () => {
        // Arrange
        const withoutDisconnect = { connected: true };

        // Act
        const release = () => releaseWorkerChannel(withoutDisconnect);

        // Assert
        expect(release).not.toThrow();
    });
});
