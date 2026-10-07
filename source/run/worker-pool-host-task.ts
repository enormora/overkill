import type { WorkerPoolTask } from './worker-pool-protocol.ts';
import type { WorkerPoolTaskWithoutPort } from './worker-pool-host-protocol.ts';
import { isWorkerPoolTaskKind } from './worker-pool-task-validation.ts';

export type WorkerPoolTaskPort = Readonly<WorkerPoolTask['port']>;

function resourceTaskWithoutPort(
    task: Exclude<WorkerPoolTask, { readonly kind: 'collect' | 'run'; }>
): WorkerPoolTaskWithoutPort {
    if (task.kind === 'prepare-resource-artifacts') {
        return {
            kind: task.kind,
            work: task.work,
            attempt: task.attempt,
            lane: task.lane,
            lifecycle: task.lifecycle,
            attachmentEndpoint: task.attachmentEndpoint
        };
    }
    if (task.kind === 'acquire-run-resources') {
        return {
            assignedWork: task.assignedWork,
            boundaryKeys: task.boundaryKeys,
            boundaryUseCounts: task.boundaryUseCounts,
            command: task.command,
            kind: 'acquire-run-resources',
            lane: task.lane,
            lifecycle: task.lifecycle
        };
    }

    if (task.kind === 'complete-resource-owner-work') {
        return {
            boundaryKeys: task.boundaryKeys,
            kind: task.kind,
            lane: task.lane,
            lifecycle: task.lifecycle
        };
    }

    return { kind: task.kind, lane: task.lane, lifecycle: task.lifecycle };
}
function runTaskWithoutPort(task: Extract<WorkerPoolTask, { readonly kind: 'run'; }>): WorkerPoolTaskWithoutPort {
    return {
        assignedUnits: task.assignedUnits,
        assignedWork: task.assignedWork,
        boundaryUseCounts: task.boundaryUseCounts,
        command: task.command,
        kind: 'run',
        lane: task.lane,
        lifecycle: task.lifecycle,
        projectedResources: task.projectedResources,
        runWork: task.runWork,
        startedAtMilliseconds: task.startedAtMilliseconds
    };
}

function taskWithoutPort(task: WorkerPoolTask): WorkerPoolTaskWithoutPort {
    if (task.kind === 'collect') {
        return { kind: task.kind, command: task.command };
    }
    if (task.kind === 'run') {
        return runTaskWithoutPort(task);
    }
    return resourceTaskWithoutPort(task);
}

function isWorkerPoolTask(value: unknown): value is WorkerPoolTask {
    return typeof value === 'object' &&
        value !== null &&
        Object.hasOwn(value, 'kind') &&
        Object.hasOwn(value, 'port') &&
        isWorkerPoolTaskKind(Reflect.get(value, 'kind'));
}

export function readWorkerPoolTask(value: unknown): WorkerPoolTask {
    if (!isWorkerPoolTask(value)) {
        throw new Error('Hosted worker-pool received an invalid task.');
    }

    return value;
}

export function readWorkerPoolTaskWithoutPort(value: unknown): WorkerPoolTaskWithoutPort {
    return taskWithoutPort(readWorkerPoolTask(value));
}
