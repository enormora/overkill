import type { ResourceUsageSnapshot, RunResourceUsage, RunnerError } from '../engine/run-result.ts';
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
    readonly assignedUnits: WorkerPoolRunTask['assignedUnits'];
    readonly assignedWork: WorkerPoolRunTask['assignedWork'];
    readonly command: WorkerPoolRunTask['command'];
    readonly kind: 'run';
    readonly lane: WorkerPoolRunTask['lane'];
    readonly startedAtMilliseconds: WorkerPoolRunTask['startedAtMilliseconds'];
};
export type WorkerPoolTaskWithoutPort = WorkerPoolCollectTaskWithoutPort | WorkerPoolRunTaskWithoutPort;

export type SerializedError = {
    readonly code: string | null;
    readonly message: string;
    readonly name: string;
    readonly permission: string | null;
    readonly resource: string | null;
    readonly stack: string | null;
};

type SerializedWorkerPoolEventMessagesByKind = {
    readonly event: Extract<WorkerPoolMessage, { readonly kind: 'event'; }>;
    readonly unitCompleted: Extract<WorkerPoolMessage, { readonly kind: 'unit-completed'; }>;
    readonly unitStarted: Extract<WorkerPoolMessage, { readonly kind: 'unit-started'; }>;
};
type SerializedWorkerPoolEventMessage =
    SerializedWorkerPoolEventMessagesByKind[keyof SerializedWorkerPoolEventMessagesByKind];

export type SerializedWorkerPoolMessage = SerializedWorkerPoolEventMessage | {
    readonly capturedAtMicroseconds: number;
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
    readonly error: RunnerError;
    readonly kind: 'runner-error';
} | {
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

function readStringProperty(value: unknown, property: string): string | null {
    if (value === null || typeof value !== 'object') {
        return null;
    }

    const propertyValue: unknown = Reflect.get(value, property);

    return typeof propertyValue === 'string' ? propertyValue : null;
}

export function serializeError(error: unknown): SerializedError {
    return {
        code: readStringProperty(error, 'code'),
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'Error',
        permission: readStringProperty(error, 'permission'),
        resource: readStringProperty(error, 'resource'),
        stack: error instanceof Error ? error.stack ?? null : null
    };
}

export function deserializeError(error: SerializedError): Error {
    const deserializedError = new Error(error.message);

    Object.defineProperties(deserializedError, {
        name: {
            value: error.name
        },
        code: {
            value: error.code
        },
        permission: {
            value: error.permission
        },
        resource: {
            value: error.resource
        },
        stack: {
            value: error.stack ?? deserializedError.stack
        }
    });

    return deserializedError;
}

export function serializeWorkerPoolMessage(message: WorkerPoolMessage): SerializedWorkerPoolMessage {
    if (message.kind !== 'output') {
        return message;
    }

    return {
        capturedAtMicroseconds: message.capturedAtMicroseconds,
        chunkBase64: Buffer.from(message.chunk).toString('base64'),
        kind: 'output',
        stream: message.stream
    };
}

export function deserializeWorkerPoolMessage(message: SerializedWorkerPoolMessage): WorkerPoolMessage {
    if (message.kind !== 'output') {
        return message;
    }

    return {
        capturedAtMicroseconds: message.capturedAtMicroseconds,
        chunk: Buffer.from(message.chunkBase64, 'base64'),
        kind: 'output',
        stream: message.stream
    };
}
