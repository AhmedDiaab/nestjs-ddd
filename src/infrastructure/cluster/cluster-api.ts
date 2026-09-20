/** The bit of a forked worker's child process `startPrimary` needs, to signal it directly. */
export type ClusterWorkerProcess = {
    readonly pid?: number;
    kill(signal?: NodeJS.Signals): boolean;
};

export type ClusterWorkerLike = {
    readonly id: number;
    readonly process: ClusterWorkerProcess;
};

export type ClusterExitListener = (
    worker: ClusterWorkerLike,
    code: number,
    signal: string | null,
) => void;

/**
 * The slice of Node's `cluster` module `startPrimary` needs. Node's real `cluster` singleton
 * (`import cluster from 'node:cluster'`) satisfies this structurally, so `main.ts` passes it
 * straight through with no adapter; tests pass a fake and never fork a real process.
 */
export type ClusterApi = {
    fork(env?: NodeJS.ProcessEnv): ClusterWorkerLike;
    on(event: 'exit', listener: ClusterExitListener): void;
    readonly workers?: Readonly<Record<string, ClusterWorkerLike | undefined>>;
};
