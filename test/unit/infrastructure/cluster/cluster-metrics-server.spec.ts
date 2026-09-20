import { get, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LoggerPort } from '@application/ports';
import { startClusterMetricsServer } from '@infrastructure/cluster';

function request(port: number, path: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        get({ host: '127.0.0.1', port, path }, (res: IncomingMessage) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += chunk.toString()));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        }).on('error', reject);
    });
}

describe('startClusterMetricsServer', () => {
    const debug = jest.fn();
    const info = jest.fn();
    const warn = jest.fn();
    const error = jest.fn();
    const logger: LoggerPort = { debug, info, warn, error };

    afterEach(() => jest.clearAllMocks());

    it('answers GET /metrics with the aggregated exposition format', async () => {
        // Arrange: port 0 lets the OS assign a free port, so tests never collide
        const server = startClusterMetricsServer({ port: 0, logger });
        await new Promise<void>((resolve) => server.once('listening', resolve));
        const { port } = server.address() as AddressInfo;

        // Act
        const response = await request(port, '/metrics');

        // Assert
        expect(response.status).toBe(200);
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('answers 404 for any other path', async () => {
        // Arrange
        const server = startClusterMetricsServer({ port: 0, logger });
        await new Promise<void>((resolve) => server.once('listening', resolve));
        const { port } = server.address() as AddressInfo;

        // Act
        const response = await request(port, '/not-metrics');

        // Assert
        expect(response.status).toBe(404);
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('logs cluster.metrics.listening with the bound port', async () => {
        // Arrange
        const server = startClusterMetricsServer({ port: 0, logger });

        // Act
        await new Promise<void>((resolve) => server.once('listening', resolve));

        // Assert
        expect(info).toHaveBeenCalledWith(
            'cluster.metrics.listening',
            expect.objectContaining({ port: expect.any(Number) as number }),
        );
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });
});
