import type { WorkerPoolTask } from './worker-pool-protocol.ts';

const workerPoolTaskKinds: ReadonlySet<string> = new Set([
    'acquire-run-resources',
    'collect',
    'complete-resource-owner-work',
    'dispose-lane-lifecycle',
    'dispose-run-resources',
    'prepare-resource-artifacts',
    'run'
]);

export function isWorkerPoolTaskKind(kind: unknown): kind is WorkerPoolTask['kind'] {
    return typeof kind === 'string' && workerPoolTaskKinds.has(kind);
}
