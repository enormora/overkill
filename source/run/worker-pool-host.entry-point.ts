import type { MessagePort as NodeMessagePort } from 'node:worker_threads';
import { createClock } from '@enormora/clock';
import { createExecutionGlobalErrorObserver } from '../engine/execution-global-error-observer.ts';
import type { RunnerError, RunResourceUsageTracker } from '../packages/engine/engine.entry-point.ts';
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
import {
    createWorkerPoolMessageChannel,
    type WorkerPoolMessage,
    type WorkerPoolMessageChannel,
    type WorkerPoolTask
} from './worker-pool-protocol.ts';

type ActiveHostTask = {
    readonly channel: WorkerPoolMessageChannel;
    readonly controller: AbortController;
};

type StoredValue<Value> = {
    readonly read: () => Value;
    readonly write: (value: Value) => void;
};

type ActiveHostTasks = {
    readonly delete: (taskId: string) => boolean;
    readonly get: (taskId: string) => ActiveHostTask | undefined;
    readonly set: (taskId: string, task: ActiveHostTask) => void;
    readonly values: () => IterableIterator<ActiveHostTask>;
};

type WorkerPoolHostState = {
    readonly activeTasks: ActiveHostTasks;
    readonly commandHandling: StoredValue<Promise<void> | null>;
    readonly pool: StoredValue<TinypoolInstance | null>;
    readonly resourceUsageTracker: StoredValue<RunResourceUsageTracker | null>;
};

type TaskWithHostPort = {
    readonly channel: WorkerPoolMessageChannel;
    readonly controller: AbortController;
    readonly task: WorkerPoolTask;
};

const sendMessage = process.send?.bind(process);
const globalErrorObserver = createExecutionGlobalErrorObserver('worker-pool-host');

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
        },
        values() {
            return tasks.values();
        }
    };
}

const state: WorkerPoolHostState = {
    activeTasks: createActiveHostTasks(),
    commandHandling: createStoredValue<Promise<void> | null>(null),
    pool: createStoredValue<TinypoolInstance | null>(null),
    resourceUsageTracker: createStoredValue<RunResourceUsageTracker | null>(null)
};
const fatalShutdownStarted = createStoredValue(false);

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
    const controller = new AbortController();
    const channel = createWorkerPoolMessageChannel(function receiveTaskMessage(message: WorkerPoolMessage) {
        forwardTaskMessage(command.taskId, message);
    });
    state.activeTasks.set(command.taskId, { channel, controller });

    return {
        channel,
        controller,
        task: {
            ...command.task,
            port: channel.port
        }
    };
}

async function runTask(command: Extract<WorkerPoolHostCommand, { readonly kind: 'run-task'; }>): Promise<void> {
    const task = taskWithHostPort(command);

    try {
        const result = await configuredPool(state).run(task.task, {
            name: 'runTask',
            signal: task.controller.signal,
            transferList: portTransferList(task.channel.port)
        });

        await task.channel.messagesCompleted;

        send({
            kind: 'task-result',
            result,
            taskId: command.taskId
        });
    } catch (error: unknown) {
        send({
            error: serializeError(error),
            kind: 'task-error',
            taskId: command.taskId
        });
    } finally {
        task.channel.close();
        state.activeTasks.delete(command.taskId);
    }
}

function abortTask(command: Extract<WorkerPoolHostCommand, { readonly kind: 'abort-task'; }>): void {
    state.activeTasks.get(command.taskId)?.controller.abort();
}

function startResourceTracking(
    command: Extract<WorkerPoolHostCommand, { readonly kind: 'start-resource-tracking'; }>
): void {
    state.resourceUsageTracker.write(createNodeResourceUsageTracker(createClock(), {
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
    globalErrorObserver.stop();
    process.disconnect?.();
}

function abortActiveTasks(): void {
    for (const task of state.activeTasks.values()) {
        task.controller.abort();
    }
}

function handleFatalHostError(error: RunnerError): void {
    if (fatalShutdownStarted.read()) {
        return;
    }

    fatalShutdownStarted.write(true);
    send({ error, kind: 'runner-error' });
    abortActiveTasks();
    state.commandHandling.write(destroy());
}

function handleLifecycleCommand(command: Exclude<WorkerPoolHostCommand, { readonly kind: 'task-reply'; }>): void {
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

function handleCommand(command: WorkerPoolHostCommand): void {
    if (command.kind === 'task-reply') {
        state.activeTasks.get(command.taskId)?.channel.reply(command.reply);
    } else {
        handleLifecycleCommand(command);
    }
}

globalErrorObserver.onFatalError(handleFatalHostError);

state.commandHandling.write(globalErrorObserver.runBoundary(async function runObservedHostProcess() {
    process.on('message', function receiveHostCommand(message: unknown) {
        const command = envelopeMessage<WorkerPoolHostCommand>(message, workerPoolHostCorrelationId);

        if (command !== null) {
            handleCommand(command);
        }
    });

    await new Promise<void>(function keepHostBoundaryOpen(resolve) {
        process.once('disconnect', resolve);
    });
}));
