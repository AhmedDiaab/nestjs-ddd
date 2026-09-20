import type { LoggerPort } from '@application/ports';
import {
    startPrimary,
    type ClusterApi,
    type ClusterExitListener,
    type ClusterMetricsServer,
    type ClusterWorkerLike,
    type StartPrimaryConfig,
} from '@infrastructure/cluster';

type ForkRecord = { worker: ClusterWorkerLike; env?: NodeJS.ProcessEnv };
type KillLogEntry = { id: number; signal: string };

/**
 * A fake `ClusterApi` that never forks a real process. `killLog` records every
 * `worker.process.kill(signal)` call instead of asserting on the member directly — see
 * `docs/decisions` on why this repo prefers recording calls into a plain array in tests.
 */
function createFakeClusterApi(): {
    clusterApi: ClusterApi;
    forked: ForkRecord[];
    killLog: KillLogEntry[];
    emitExit: (worker: ClusterWorkerLike, code?: number, signal?: string | null) => void;
} {
    let nextId = 1;
    const exitListeners: ClusterExitListener[] = [];
    const forked: ForkRecord[] = [];
    const killLog: KillLogEntry[] = [];

    const clusterApi: ClusterApi = {
        fork: (env) => {
            const id = nextId++;
            const worker: ClusterWorkerLike = {
                id,
                process: {
                    pid: 1000 + id,
                    kill: (signal) => {
                        killLog.push({ id, signal: signal ?? 'SIGTERM' });
                        return true;
                    },
                },
            };
            forked.push({ worker, env });
            return worker;
        },
        on: (event, listener) => {
            if (event === 'exit') exitListeners.push(listener);
        },
    };

    return {
        clusterApi,
        forked,
        killLog,
        emitExit: (worker, code = 1, signal = null) =>
            exitListeners.forEach((listener) => listener(worker, code, signal)),
    };
}

/** A fake `process`: captures signal handlers instead of registering real ones. */
function createFakeProcessApi(): {
    processApi: Pick<NodeJS.Process, 'on' | 'exit'>;
    trigger: (event: string) => void;
    exitCalls: number[];
} {
    const handlers = new Map<string, () => void>();
    const exitCalls: number[] = [];
    const processApi = {
        on: (event: string, listener: () => void) => {
            handlers.set(event, listener);
            return processApi;
        },
        exit: (code?: number) => exitCalls.push(code ?? 0),
    } as unknown as Pick<NodeJS.Process, 'on' | 'exit'>;

    return { processApi, exitCalls, trigger: (event: string) => handlers.get(event)?.() };
}

const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

const baseConfig = (overrides: Partial<StartPrimaryConfig> = {}): StartPrimaryConfig => ({
    cluster: { workers: 2, respawn: true, respawnMaxPerMinute: 10, metricsPort: undefined },
    idempotency: { store: 'oracle' },
    http: { throttleStorage: 'redis', throttleLimit: 100 },
    metrics: { enabled: false },
    shutdown: { drainDelayMs: 1, forceAfterMs: 1, jobDrainMs: 1 },
    database: undefined,
    ...overrides,
});

/** Records `close()` calls into a plain flag instead of a jest mock on a typed member. */
function createFakeMetricsServer(): { server: ClusterMetricsServer; closed: boolean[] } {
    const closed: boolean[] = [];
    return {
        server: {
            close: (callback?: (error?: Error) => void) => {
                closed.push(true);
                callback?.();
            },
        },
        closed,
    };
}

describe('startPrimary', () => {
    const debug = jest.fn();
    const info = jest.fn();
    const warn = jest.fn();
    const error = jest.fn();
    const logger: LoggerPort = { debug, info, warn, error };

    afterEach(() => jest.clearAllMocks());

    it('marks the first forked worker as the leader', () => {
        // Arrange
        const { clusterApi, forked } = createFakeClusterApi();
        const { processApi } = createFakeProcessApi();

        // Act
        startPrimary({ clusterApi, config: baseConfig(), logger, cpuCount: 2, processApi });

        // Assert
        expect(forked[0].env).toMatchObject({ CLUSTER_LEADER: 'true' });
        expect(forked[1].env).toMatchObject({ CLUSTER_LEADER: 'false' });
        expect(info).toHaveBeenCalledWith(
            'cluster.leader.elected',
            expect.objectContaining({ id: forked[0].worker.id }),
        );
    });

    it('elects a new leader when the leader exits and is respawned', () => {
        // Arrange
        const { clusterApi, forked, emitExit } = createFakeClusterApi();
        const { processApi } = createFakeProcessApi();
        startPrimary({
            clusterApi,
            config: baseConfig(),
            logger,
            cpuCount: 2,
            processApi,
            now: () => 0,
        });
        const leader = forked[0].worker;

        // Act
        emitExit(leader, 1, null);

        // Assert
        const replacement = forked[forked.length - 1];
        expect(replacement.env).toMatchObject({ CLUSTER_LEADER: 'true' });
        expect(info).toHaveBeenCalledWith(
            'cluster.leader.elected',
            expect.objectContaining({ id: replacement.worker.id }),
        );
    });

    it('does not re-elect a leader when the leader exits and respawn is off', () => {
        // Arrange
        const { clusterApi, forked, emitExit } = createFakeClusterApi();
        const { processApi } = createFakeProcessApi();
        startPrimary({
            clusterApi,
            config: baseConfig({
                cluster: {
                    workers: 2,
                    respawn: false,
                    respawnMaxPerMinute: 10,
                    metricsPort: undefined,
                },
            }),
            logger,
            cpuCount: 2,
            processApi,
        });
        const leader = forked[0].worker;
        const before = forked.length;

        // Act
        emitExit(leader, 1, null);

        // Assert
        expect(forked.length).toBe(before);
        expect(warn).toHaveBeenCalledWith('cluster.leader.lost', { id: leader.id });
    });

    it('respawns a non-leader worker that exits unexpectedly', () => {
        // Arrange
        const { clusterApi, forked, emitExit } = createFakeClusterApi();
        const { processApi } = createFakeProcessApi();
        startPrimary({ clusterApi, config: baseConfig(), logger, cpuCount: 2, processApi });
        const before = forked.length;
        const worker = forked[1].worker; // not the leader

        // Act
        emitExit(worker, 1, null);

        // Assert
        expect(forked.length).toBe(before + 1);
        expect(warn).toHaveBeenCalledWith(
            'cluster.worker.exited',
            expect.objectContaining({ id: worker.id, leader: false }),
        );
    });

    it('stops respawning once shutdown has begun', () => {
        // Arrange
        const { clusterApi, forked, emitExit } = createFakeClusterApi();
        const { processApi, trigger } = createFakeProcessApi();
        startPrimary({
            clusterApi,
            config: baseConfig(),
            logger,
            cpuCount: 2,
            processApi,
            delay: () => new Promise(() => {}), // shutdown never completes within this test
        });
        trigger('SIGTERM'); // begins shutdown synchronously (shuttingDown flips before any await)
        const before = forked.length;

        // Act
        emitExit(forked[0].worker, 0, 'SIGTERM');

        // Assert
        expect(forked.length).toBe(before);
    });

    it('holds the respawn rate cap, refusing once the per-minute limit is reached', () => {
        // Arrange
        const { clusterApi, forked, emitExit } = createFakeClusterApi();
        const { processApi } = createFakeProcessApi();
        const nowMs = 0;
        startPrimary({
            clusterApi,
            config: baseConfig({
                cluster: {
                    workers: 1,
                    respawn: true,
                    respawnMaxPerMinute: 2,
                    metricsPort: undefined,
                },
            }),
            logger,
            cpuCount: 1,
            processApi,
            now: () => nowMs,
        });

        // Act: two respawns are allowed, the third is rate-limited
        emitExit(forked[0].worker, 1, null);
        emitExit(forked[1].worker, 1, null);
        const beforeThird = forked.length;
        emitExit(forked[2].worker, 1, null);

        // Assert
        expect(forked.length).toBe(beforeThird);
        expect(warn).toHaveBeenCalledWith(
            'cluster.respawn.rate_limited',
            expect.objectContaining({ limit: 2 }),
        );
    });

    it('resets the respawn cap once the rolling window has passed', () => {
        // Arrange
        const { clusterApi, forked, emitExit } = createFakeClusterApi();
        const { processApi } = createFakeProcessApi();
        let nowMs = 0;
        startPrimary({
            clusterApi,
            config: baseConfig({
                cluster: {
                    workers: 1,
                    respawn: true,
                    respawnMaxPerMinute: 1,
                    metricsPort: undefined,
                },
            }),
            logger,
            cpuCount: 1,
            processApi,
            now: () => nowMs,
        });
        emitExit(forked[0].worker, 1, null); // consumes the only slot in the window

        // Act
        nowMs = 60_001; // just past the 60s rolling window
        const before = forked.length;
        emitExit(forked[1].worker, 1, null);

        // Assert
        expect(forked.length).toBe(before + 1);
    });

    it('forwards the shutdown signal to every live worker explicitly', () => {
        // Arrange
        const { clusterApi, forked, killLog } = createFakeClusterApi();
        const { processApi, trigger } = createFakeProcessApi();
        startPrimary({
            clusterApi,
            config: baseConfig({
                cluster: {
                    workers: 3,
                    respawn: true,
                    respawnMaxPerMinute: 10,
                    metricsPort: undefined,
                },
            }),
            logger,
            cpuCount: 3,
            processApi,
            delay: () => new Promise(() => {}),
        });

        // Act
        trigger('SIGTERM');

        // Assert
        forked.forEach(({ worker }) =>
            expect(killLog).toContainEqual({ id: worker.id, signal: 'SIGTERM' }),
        );
    });

    it('SIGKILLs a worker that outlives the bounded shutdown wait, then exits', async () => {
        // Arrange
        const { clusterApi, forked, killLog } = createFakeClusterApi();
        const { processApi, trigger, exitCalls } = createFakeProcessApi();
        startPrimary({
            clusterApi,
            config: baseConfig({
                cluster: {
                    workers: 1,
                    respawn: true,
                    respawnMaxPerMinute: 10,
                    metricsPort: undefined,
                },
            }),
            logger,
            cpuCount: 1,
            processApi,
            delay: () => Promise.resolve(), // the wait "elapses" immediately; the worker never exits
        });

        // Act
        trigger('SIGTERM');
        await flushMicrotasks();
        await flushMicrotasks();

        // Assert
        expect(killLog).toContainEqual({ id: forked[0].worker.id, signal: 'SIGKILL' });
        expect(warn).toHaveBeenCalledWith('cluster.drain.timeout', expect.anything());
        expect(exitCalls).toEqual([0]);
    });

    it('does not SIGKILL when every worker exits before the bounded wait ends', async () => {
        // Arrange
        const { clusterApi, forked, emitExit, killLog } = createFakeClusterApi();
        const { processApi, trigger, exitCalls } = createFakeProcessApi();
        startPrimary({
            clusterApi,
            config: baseConfig({
                cluster: {
                    workers: 1,
                    respawn: true,
                    respawnMaxPerMinute: 10,
                    metricsPort: undefined,
                },
            }),
            logger,
            cpuCount: 1,
            processApi,
            delay: () => new Promise(() => {}), // never times out in this test
        });
        const worker = forked[0].worker;

        // Act
        trigger('SIGTERM');
        emitExit(worker, 0, 'SIGTERM'); // the worker exits promptly after receiving the signal
        await flushMicrotasks();

        // Assert
        expect(killLog.some((entry) => entry.signal === 'SIGKILL')).toBe(false);
        expect(exitCalls).toEqual([0]);
    });

    it('ignores a second shutdown signal instead of shutting down twice', async () => {
        // Arrange
        const { clusterApi } = createFakeClusterApi();
        const { processApi, trigger, exitCalls } = createFakeProcessApi();
        startPrimary({
            clusterApi,
            config: baseConfig(),
            logger,
            cpuCount: 2,
            processApi,
            delay: () => Promise.resolve(),
        });

        // Act
        trigger('SIGTERM');
        await flushMicrotasks();
        await flushMicrotasks();
        trigger('SIGINT');
        await flushMicrotasks();

        // Assert
        expect(exitCalls).toEqual([0]);
    });

    it('starts the aggregated metrics server when clustered with metrics enabled and a port set', () => {
        // Arrange
        const { clusterApi } = createFakeClusterApi();
        const { processApi } = createFakeProcessApi();
        const { server } = createFakeMetricsServer();
        const startMetricsServer = jest.fn(() => server);

        // Act
        startPrimary({
            clusterApi,
            config: baseConfig({
                cluster: { workers: 1, respawn: true, respawnMaxPerMinute: 10, metricsPort: 9091 },
                metrics: { enabled: true },
            }),
            logger,
            cpuCount: 1,
            processApi,
            startMetricsServer,
        });

        // Assert
        expect(startMetricsServer).toHaveBeenCalledWith(
            expect.objectContaining({ port: 9091, logger }),
        );
    });

    it('does not start a metrics server when no CLUSTER_METRICS_PORT is set', () => {
        // Arrange
        const { clusterApi } = createFakeClusterApi();
        const { processApi } = createFakeProcessApi();
        const { server } = createFakeMetricsServer();
        const startMetricsServer = jest.fn(() => server);

        // Act
        startPrimary({
            clusterApi,
            config: baseConfig({ metrics: { enabled: true } }),
            logger,
            cpuCount: 1,
            processApi,
            startMetricsServer,
        });

        // Assert
        expect(startMetricsServer).not.toHaveBeenCalled();
    });

    it('closes the metrics server as part of shutdown', async () => {
        // Arrange
        const { clusterApi } = createFakeClusterApi();
        const { processApi, trigger } = createFakeProcessApi();
        const { server, closed } = createFakeMetricsServer();
        startPrimary({
            clusterApi,
            config: baseConfig({
                cluster: { workers: 1, respawn: true, respawnMaxPerMinute: 10, metricsPort: 9091 },
                metrics: { enabled: true },
            }),
            logger,
            cpuCount: 1,
            processApi,
            startMetricsServer: () => server,
            delay: () => Promise.resolve(),
        });

        // Act
        trigger('SIGTERM');
        await flushMicrotasks();
        await flushMicrotasks();

        // Assert
        expect(closed).toEqual([true]);
    });

    it('fails fast before forking anything when IDEMPOTENCY_STORE=memory with more than one worker', () => {
        // Arrange
        const { clusterApi, forked } = createFakeClusterApi();
        const { processApi } = createFakeProcessApi();

        // Act
        const act = () =>
            startPrimary({
                clusterApi,
                config: baseConfig({ idempotency: { store: 'memory' } }),
                logger,
                cpuCount: 2,
                processApi,
            });

        // Assert
        expect(act).toThrow(/IDEMPOTENCY_STORE/);
        expect(forked).toHaveLength(0);
    });
});
