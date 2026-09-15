import {
    MessageChannel as NodeMessageChannel,
    type MessagePort as NodeMessagePort
} from 'node:worker_threads';
import { createWallClock } from '@enormora/wall-clock';
import type { RunResourceUsageTracker } from '../engine/run-result.ts';
import {
    childProcessEnvelope,
    envelopeMessage
} from './child-process-protocol.ts';
import {
    createNodeResourceUsageTracker
} from './resource-usage.ts';
import {
    createTinypoolWorkerPool,
    workerPoolEntryPoint
} from './worker-pool-runtime.ts';
import type { TinypoolInstance } from './tinypool-node-compatibility.ts';
import {
    serializeError,
    serializeWorkerPoolMessage,
    type WorkerPoolHostCommand,
    workerPoolHostCorrelationId,
    type WorkerPoolHostMessage
} from './worker-pool-host-protocol.ts';
import type { WorkerPoolMessage, WorkerPoolTask } from './worker-pool-protocol.ts';

type ActiveHostTask = {
    readonly controller: AbortController;
    readonly port: NodeMessagePort;
};

type StoredValue<Value> = {
    readonly read: () => Value;
    readonly write: (value: Value) => void;
};

type ActiveHostTasks = {
    readonly delete: (taskId: string) => boolean;
    readonly get: (taskId: string) => ActiveHostTask | undefined;
    readonly set: (taskId: string, task: ActiveHostTask) => void;
};

type WorkerPoolHostState = {
    readonly activeTasks: ActiveHostTasks;
    readonly commandHandling: StoredValue<Promise<void> | null>;
    readonly pool: StoredValue<TinypoolInstance | null>;
    readonly resourceUsageTracker: StoredValue<RunResourceUsageTracker | null>;
};

type TaskWithHostPort = {
    readonly controller: AbortController;
    readonly port1: NodeMessagePort;
    readonly task: WorkerPoolTask;
};

const sendMessage = process.send?.bind(process);
function createStoredValue<Value>(initialValue: Value): StoredValue<Value> {
    let currentValue = initialValue;

    return {
        read() {
            return currentValue;
        },
        write(value) {
            currentValue = value;
        }
    };
}

function createActiveHostTasks(): ActiveHostTasks {
    const tasks = new Map<string, ActiveHostTask>();

    return {
        delete(taskId) {
            return tasks.delete(taskId);
        },
        get(taskId) {
            return tasks.get(taskId);
        },
        set(taskId, task) {
            tasks.set(taskId, task);
        }
    };
}

const state: WorkerPoolHostState = {
    activeTasks: createActiveHostTasks(),
    commandHandling: createStoredValue<Promise<void> | null>(null),
    pool: createStoredValue<TinypoolInstance | null>(null),
    resourceUsageTracker: createStoredValue<RunResourceUsageTracker | null>(null)
};

function send(message: WorkerPoolHostMessage): void {
    sendMessage?.(childProcessEnvelope(workerPoolHostCorrelationId, message));
}

function portTransferList(port: NodeMessagePort): readonly NodeMessagePort[] {
    return [ port ];
}

function configuredPool(hostState: WorkerPoolHostState): TinypoolInstance {
    const pool = hostState.pool.read();

    if (pool === null) {
        throw new Error('Hosted worker pool was not configured.');
    }

    return pool;
}

function configure(
    command: Extract<WorkerPoolHostCommand, { readonly kind: 'configure'; }>
): void {
    state.pool.write(createTinypoolWorkerPool({
        ...command.options,
        filename: workerPoolEntryPoint
    }));
    send({ kind: 'configured' });
}

function forwardTaskMessage(taskId: string, message: WorkerPoolMessage): void {
    send({
        kind: 'task-message',
        message: serializeWorkerPoolMessage(message),
        taskId
    });
}

function taskWithHostPort(
    command: Extract<WorkerPoolHostCommand, { readonly kind: 'run-task'; }>
): TaskWithHostPort {
    const { port1, port2 } = new NodeMessageChannel();
    const controller = new AbortController();

    state.activeTasks.set(command.taskId, { controller, port: port2 });
    port2.on('message', function receiveTaskMessage(message: WorkerPoolMessage) {
        forwardTaskMessage(command.taskId, message);
    });

    return {
        controller,
        port1,
        task: {
            ...command.task,
            port: port1
        }
    };
}

async function runTask(command: Extract<WorkerPoolHostCommand, { readonly kind: 'run-task'; }>): Promise<void> {
    const task = taskWithHostPort(command);

    try {
        send({
            kind: 'task-result',
            result: await configuredPool(state).run(task.task, {
                name: 'runTask',
                signal: task.controller.signal,
                transferList: portTransferList(task.port1)
            }),
            taskId: command.taskId
        });
    } catch (error: unknown) {
        send({
            error: serializeError(error),
            kind: 'task-error',
            taskId: command.taskId
        });
    } finally {
        task.port1.close();
        state.activeTasks.get(command.taskId)?.port.close();
        state.activeTasks.delete(command.taskId);
    }
}

function abortTask(command: Extract<WorkerPoolHostCommand, { readonly kind: 'abort-task'; }>): void {
    state.activeTasks.get(command.taskId)?.controller.abort();
}

function startResourceTracking(
    command: Extract<WorkerPoolHostCommand, { readonly kind: 'start-resource-tracking'; }>
): void {
    state.resourceUsageTracker.write(createNodeResourceUsageTracker(createWallClock(), {
        samplingIntervalMilliseconds: command.samplingIntervalMilliseconds
    }));
    state.resourceUsageTracker.read()?.start(function sendSample(sample) {
        send({ kind: 'resource-sample', sample });
    });
}

function finishResourceTracking(): void {
    const resourceUsageTracker = state.resourceUsageTracker.read();

    if (resourceUsageTracker === null) {
        return;
    }

    send({
        kind: 'resource-usage',
        resourceUsage: resourceUsageTracker.finish()
    });
    state.resourceUsageTracker.write(null);
}

async function destroy(): Promise<void> {
    const poolToDestroy = state.pool.read();

    state.pool.write(null);
    finishResourceTracking();
    await poolToDestroy?.destroy();
    send({ kind: 'destroyed' });
    process.disconnect?.();
}

function handleCommand(command: WorkerPoolHostCommand): void {
    if (command.kind === 'configure') {
        configure(command);
    } else if (command.kind === 'run-task') {
        state.commandHandling.write(runTask(command));
    } else if (command.kind === 'abort-task') {
        abortTask(command);
    } else if (command.kind === 'start-resource-tracking') {
        startResourceTracking(command);
    } else if (command.kind === 'finish-resource-tracking') {
        finishResourceTracking();
    } else {
        state.commandHandling.write(destroy());
    }
}

process.on('message', function receiveHostCommand(message: unknown) {
    const command = envelopeMessage<WorkerPoolHostCommand>(message, workerPoolHostCorrelationId);

    if (command !== null) {
        handleCommand(command);
    }
});
