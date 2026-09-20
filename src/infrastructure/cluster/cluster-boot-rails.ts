import type { LoggerPort } from '@application/ports';
import { InvalidConfigError } from '@infrastructure/config';

/**
 * Config slice `runClusterBootRails` reads — narrower than `AppConfig` on purpose, so a test
 * builds a small fixture instead of a full, valid config for every section. `AppConfig` satisfies
 * this structurally, so `startPrimary` passes it straight through.
 */
export type ClusterBootRailsConfig = {
    idempotency: { store: 'memory' | 'oracle' };
    http: { throttleStorage: 'memory' | 'redis'; throttleLimit: number };
    database?: { sources: ReadonlyArray<{ key: string; poolMax: number }> };
};

/**
 * Runs once in the primary, before any worker is forked. A worker-per-CPU process model turns a
 * few single-process assumptions into either silent incorrectness or a capacity problem that
 * would otherwise stay invisible until traffic finds it — catch them here instead.
 */
export function runClusterBootRails(
    config: ClusterBootRailsConfig,
    workerCount: number,
    logger: LoggerPort,
): void {
    if (workerCount > 1 && config.idempotency.store === 'memory') {
        throw new InvalidConfigError([
            {
                path: 'idempotency.store',
                code: 'custom',
                message:
                    'IDEMPOTENCY_STORE=memory is single-instance only: state lives in the memory ' +
                    `of one process, not shared across replicas. Cluster mode would run ${workerCount} ` +
                    'worker processes, so a claim made on one worker is invisible to the others and ' +
                    'the same request could run twice — worse than refusing to start. Set ' +
                    'IDEMPOTENCY_STORE=oracle, or run a single worker (CLUSTER_WORKERS=1).',
            },
        ]);
    }

    if (workerCount > 1 && config.http.throttleStorage === 'memory') {
        logger.warn('cluster.throttle.memory', {
            limitPerWorker: config.http.throttleLimit,
            workers: workerCount,
            effectiveLimit: config.http.throttleLimit * workerCount,
        });
    }

    for (const source of config.database?.sources ?? []) {
        logger.info('cluster.pool.capacity', {
            source: source.key,
            poolMax: source.poolMax,
            workers: workerCount,
            totalSessions: source.poolMax * workerCount,
        });
    }
}
