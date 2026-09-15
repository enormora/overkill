import type { ResourceUsageSnapshot, RunResourceUsage } from '../engine/run-result.ts';
import type { WorkerPoolCreationOptions } from './run-orchestrator-dependencies.ts';
import type {
    WorkerPoolMessage,
    WorkerPoolTask
} from './worker-pool-protocol.ts';

export const workerPoolHostCorrelationId = 'worker-pool-host';

type WorkerPoolCollectTask = Extract<WorkerPoolTask, { readonly kind: 'collect'; }>;
type WorkerPoolRunTask = Extract<WorkerPoolTask, { readonly kind: 'run'; }>;
type WorkerPoolCollectTaskWithoutPort = {
    readonly command: WorkerPoolCollectTask['command'];
    readonly kind: 'collect';
};
type WorkerPoolRunTaskWithoutPort = {
    readonly assignedWork: WorkerPoolRunTask['assignedWork'];
    readonly command: WorkerPoolRunTask['command'];
    readonly kind: 'run';
    readonly startedAtMilliseconds: WorkerPoolRunTask['startedAtMilliseconds'];
};
export type WorkerPoolTaskWithoutPort = WorkerPoolCollectTaskWithoutPort | WorkerPoolRunTaskWithoutPort;

export type SerializedError = {
    readonly message: string;
    readonly name: string;
    readonly stack: string | null;
};

export type SerializedWorkerPoolMessage = Extract<WorkerPoolMessage, { readonly kind: 'event'; }> | {
    readonly capturedAtMilliseconds: number;
    readonly chunkBase64: string;
    readonly kind: 'output';
    readonly stream: 'stderr' | 'stdout';
};

export type WorkerPoolHostCommand = {
    readonly kind: 'abort-task';
    readonly taskId: string;
} | {
    readonly kind: 'configure';
    readonly options: WorkerPoolCreationOptions;
} | {
    readonly kind: 'destroy';
} | {
    readonly kind: 'finish-resource-tracking';
} | {
    readonly kind: 'run-task';
    readonly task: WorkerPoolTaskWithoutPort;
    readonly taskId: string;
} | {
    readonly kind: 'start-resource-tracking';
    readonly samplingIntervalMilliseconds: number;
};

export type WorkerPoolHostMessage = {
    readonly kind: 'configured';
} | {
    readonly kind: 'destroyed';
} | {
    readonly kind: 'resource-sample';
    readonly sample: ResourceUsageSnapshot;
} | {
    readonly kind: 'resource-usage';
    readonly resourceUsage: RunResourceUsage;
} | {
    readonly kind: 'task-error';
    readonly error: SerializedError;
    readonly taskId: string;
} | {
    readonly kind: 'task-message';
    readonly message: SerializedWorkerPoolMessage;
    readonly taskId: string;
} | {
    readonly kind: 'task-result';
    readonly result: unknown;
    readonly taskId: string;
};

export function serializeError(error: unknown): SerializedError {
    if (error instanceof Error) {
        return {
            message: error.message,
            name: error.name,
            stack: error.stack ?? null
        };
    }

    return {
        message: String(error),
        name: 'Error',
        stack: null
    };
}

export function deserializeError(error: SerializedError): Error {
    const deserializedError = new Error(error.message);

    Object.defineProperties(deserializedError, {
        name: {
            value: error.name
        },
        stack: {
            value: error.stack ?? deserializedError.stack
        }
    });

    return deserializedError;
}

export function serializeWorkerPoolMessage(message: WorkerPoolMessage): SerializedWorkerPoolMessage {
    if (message.kind === 'event') {
        return message;
    }

    return {
        capturedAtMilliseconds: message.capturedAtMilliseconds,
        chunkBase64: Buffer.from(message.chunk).toString('base64'),
        kind: 'output',
        stream: message.stream
    };
}

export function deserializeWorkerPoolMessage(message: SerializedWorkerPoolMessage): WorkerPoolMessage {
    if (message.kind === 'event') {
        return message;
    }

    return {
        capturedAtMilliseconds: message.capturedAtMilliseconds,
        chunk: Buffer.from(message.chunkBase64, 'base64'),
        kind: 'output',
        stream: message.stream
    };
}
