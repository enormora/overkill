import { threadId } from 'node:worker_threads';

type WorkerLifecycleProbeResult = {
    readonly assignedUnits: number;
    readonly threadId: number;
};

const workerLifecycleProbeState = { assignedUnits: 0 };

export function workerLifecycleProbe(): WorkerLifecycleProbeResult {
    workerLifecycleProbeState.assignedUnits += 1;

    return {
        assignedUnits: workerLifecycleProbeState.assignedUnits,
        threadId
    };
}
