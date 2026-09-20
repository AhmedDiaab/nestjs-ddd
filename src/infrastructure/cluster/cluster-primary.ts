import { cpus } from 'node:os';
import type { LoggerPort } from '@application/ports';
import { delay as sleep } from '@common/utils';
import type { ClusterApi, ClusterExitListener, ClusterWorkerLike } from './cluster-api';
import { runClusterBootRails, type ClusterBootRailsConfig } from './cluster-boot-rails';
import { startClusterMetricsServer } from './cluster-metrics-server';
import { resolveWorkerCount } from './resolve-worker-count.util';

/** Extra time past the drain/force/job-drain budget before a still-open worker gets SIGKILLed. */
const SHUTDOWN_SLACK_MS = 2000;
/** Respawns are rate-capped over this rolling window. */
const RESPAWN_WINDOW_MS = 60_000;

/** A server the primary can shut down; the real implementation is `node:http`'s `Server`. */
export type ClusterMetricsServer = {
    close(callback?: (error?: Error) => void): unknown;
};

/**
 * Config slice `startPrimary` reads — narrower than `AppConfig` so a test builds a small fixture
 * instead of a full, valid config for every section. `AppConfig` satisfies this structurally, so
 * `main.ts` passes `loadConfig()`'s result straight through.
 */
export type StartPrimaryConfig = ClusterBootRailsConfig & {
    cluster: {
        workers: number;
        respawn: boolean;
        respawnMaxPerMinute: number;
        metricsPort?: number;
    };
    metrics: { enabled: boolean };
    shutdown: { drainDelayMs: number; forceAfterMs: number; jobDrainMs: number };
};

export type StartPrimaryDeps = {
    clusterApi: ClusterApi;
    config: StartPrimaryConfig;
    logger: LoggerPort;
    /** Defaults to `os.cpus().length`; injected so tests don't depend on the host's core count. */
    cpuCount?: number;
    /** Defaults to the real `process`; injected so tests never register a real signal handler. */
    processApi?: Pick<NodeJS.Process, 'on' | 'exit'>;
    delay?: (ms: number) => Promise<void>;
    now?: () => number;
    startMetricsServer?: (deps: { port: number; logger: LoggerPort }) => ClusterMetricsServer;
};

/**
 * Runs only in the primary process (`cluster.enabled && cluster.isPrimary`, checked by
 * `main.ts` before calling this). Forks the worker pool, keeps exactly one worker marked as the
 * scheduler leader, respawns workers that exit unexpectedly (rate-capped), and — on `SIGTERM`/
 * `SIGINT` — forwards the signal to every worker explicitly instead of relying on the OS to
 * propagate it (Windows in particular does not), then waits a bounded time before SIGKILLing
 * stragglers.
 *
 * Never builds a Nest application: no database pools, no HTTP server, no Swagger. See
 * decision 0012.
 */
export function startPrimary(deps: StartPrimaryDeps): void {
    const {
        clusterApi,
        config,
        logger,
        cpuCount = cpus().length,
        processApi = process,
        delay = sleep,
        now = Date.now,
        startMetricsServer = startClusterMetricsServer,
    } = deps;

    const workerCount = resolveWorkerCount(config.cluster.workers, cpuCount);

    // Before anything is forked: a memory idempotency store with more than one worker fails
    // fast here, the same posture as any other invalid configuration.
    runClusterBootRails(config, workerCount, logger);

    const liveWorkers = new Map<number, ClusterWorkerLike>();
    const respawnTimestamps: number[] = [];
    let leaderId: number | undefined;
    let shuttingDown = false;
    let notifyDrained: (() => void) | undefined;

    const metricsServer =
        config.cluster.metricsPort && config.metrics.enabled
            ? startMetricsServer({ port: config.cluster.metricsPort, logger })
            : undefined;

    function forkWorker(isLeader: boolean): ClusterWorkerLike {
        const worker = clusterApi.fork({ CLUSTER_LEADER: isLeader ? 'true' : 'false' });
        liveWorkers.set(worker.id, worker);
        if (isLeader) leaderId = worker.id;
        logger.info('cluster.worker.started', {
            id: worker.id,
            pid: worker.process.pid,
            leader: isLeader,
        });
        return worker;
    }

    for (let index = 0; index < workerCount; index += 1) forkWorker(index === 0);
    logger.info('cluster.leader.elected', { id: leaderId, workers: workerCount });

    const onExit: ClusterExitListener = (worker, code, signal) => {
        const wasLeader = worker.id === leaderId;
        liveWorkers.delete(worker.id);
        logger.warn('cluster.worker.exited', {
            id: worker.id,
            pid: worker.process.pid,
            code,
            signal,
            leader: wasLeader,
        });

        if (liveWorkers.size === 0) notifyDrained?.();
        if (shuttingDown) return; // no respawn once shutdown has begun

        if (!config.cluster.respawn) {
            if (wasLeader) {
                leaderId = undefined;
                logger.warn('cluster.leader.lost', { id: worker.id });
            }
            return;
        }

        const windowStart = now() - RESPAWN_WINDOW_MS;
        while (respawnTimestamps.length && respawnTimestamps[0] < windowStart) {
            respawnTimestamps.shift();
        }
        if (respawnTimestamps.length >= config.cluster.respawnMaxPerMinute) {
            logger.warn('cluster.respawn.rate_limited', {
                limit: config.cluster.respawnMaxPerMinute,
            });
            if (wasLeader) {
                leaderId = undefined;
                logger.warn('cluster.leader.lost', { id: worker.id });
            }
            return;
        }
        respawnTimestamps.push(now());

        const replacement = forkWorker(wasLeader);
        if (wasLeader) {
            logger.info('cluster.leader.elected', { id: replacement.id, workers: workerCount });
        }
    };

    clusterApi.on('exit', onExit);

    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info('cluster.shutdown.started', { signal, workers: liveWorkers.size });

        for (const worker of liveWorkers.values()) {
            worker.process.kill(signal);
        }

        const waitMs =
            config.shutdown.drainDelayMs +
            config.shutdown.forceAfterMs +
            config.shutdown.jobDrainMs +
            SHUTDOWN_SLACK_MS;

        const drained = new Promise<'drained'>((resolve) => {
            if (liveWorkers.size === 0) {
                resolve('drained');
                return;
            }
            notifyDrained = () => resolve('drained');
        });

        const outcome = await Promise.race([
            drained,
            delay(waitMs).then((): 'timeout' => 'timeout'),
        ]);

        if (outcome === 'timeout' && liveWorkers.size > 0) {
            logger.warn('cluster.drain.timeout', { remaining: [...liveWorkers.keys()], waitMs });
            for (const worker of liveWorkers.values()) {
                worker.process.kill('SIGKILL');
            }
        }

        if (metricsServer) {
            await new Promise<void>((resolve) => metricsServer.close(() => resolve()));
        }

        logger.info('cluster.shutdown.finished', { signal });
        processApi.exit(0);
    };

    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        processApi.on(signal, () => void shutdown(signal));
    }
}
