import { randomUUID } from 'node:crypto';
import type {
    RunResourceUsage,
    RunResourceUsageTracker,
    ResourceUsageSnapshot
} from '../engine/run-result.ts';
import type { RuntimeCapabilityPolicyEnvironment } from './capability-policy-snapshots.ts';
import {
    childProcessEnvelope,
    envelopeMessage
} from './child-process-protocol.ts';
import {
    childRoleArgument,
    workerPoolHostRole
} from './child-process-roles.ts';
import type {
    CreatedWorkerPool,
    WorkerPoolCreationOptions,
    WorkerPoolHostOutputSink,
    WorkerPoolHostProcessStartOptions,
    WorkerPoolHostProcessStarter
} from './run-orchestrator-dependencies.ts';
import { createResourceUsageFromSamples } from './resource-usage.ts';
import {
    sanitizedChildEnvironment,
    type SupervisedChildProcess
} from './supervised-child-process.ts';
import type { WorkerPoolTask } from './worker-pool-protocol.ts';
import {
    deserializeError,
    deserializeWorkerPoolMessage,
    type WorkerPoolHostCommand,
    workerPoolHostCorrelationId,
    type WorkerPoolHostMessage,
    type WorkerPoolTaskWithoutPort
} from './worker-pool-host-protocol.ts';

type WorkerPoolHostForkOptions = {
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    readonly execArgv: readonly string[];
    readonly stdio: readonly ['ignore', 'pipe', 'pipe', 'ipc'];
};

type WorkerPoolHostProcessStarterDependencies = {
    readonly childProcessEntryPoint: string;
    readonly fork: (
        modulePath: string,
        childArguments: readonly string[],
        options: WorkerPoolHostForkOptions
    ) => SupervisedChildProcess;
};

type PendingHostTask = {
    readonly port: WorkerPoolTask['port'];
    readonly reject: (error: unknown) => void;
    readonly resolve: (value: unknown) => void;
};

type HostResourceUsageTracker = RunResourceUsageTracker & {
    readonly waitForStart: () => Promise<void>;
};

type CompletionSignal = {
    readonly promise: Promise<void>;
    readonly reject: (error: Error) => void;
    readonly resolve: () => void;
};

type HostRuntime = {
    readonly child: SupervisedChildProcess;
    readonly configured: Promise<void>;
    readonly finished: Promise<void>;
};

type HostedWorkerPoolInput = {
    readonly environmentVariables: RuntimeCapabilityPolicyEnvironment;
    readonly options: WorkerPoolCreationOptions;
    readonly startWorkerPoolHost: WorkerPoolHostProcessStarter;
};

type StoredValue<Value> = {
    readonly read: () => Value;
    readonly write: (value: Value) => void;
};

type PendingHostTasks = {
    readonly clear: () => void;
    readonly delete: (taskId: string) => boolean;
    readonly get: (taskId: string) => PendingHostTask | undefined;
    readonly set: (taskId: string, task: PendingHostTask) => void;
    readonly values: () => IterableIterator<PendingHostTask>;
};

type ResourceUsageSamples = {
    readonly clear: () => void;
    readonly hasAny: () => boolean;
    readonly push: (sample: ResourceUsageSnapshot) => void;
    readonly read: () => readonly ResourceUsageSnapshot[];
};

type HostResourceTrackingState = {
    readonly sampleListener: StoredValue<((sample: ResourceUsageSnapshot) => void) | null>;
    readonly resolveFirstSample: StoredValue<(() => void) | null>;
    readonly samples: ResourceUsageSamples;
    readonly start: StoredValue<Promise<void> | null>;
};

type HostedWorkerPoolState = {
    readonly outputSink: StoredValue<WorkerPoolHostOutputSink | null>;
    readonly pendingTasks: PendingHostTasks;
    readonly resourceUsage: HostResourceTrackingState;
    readonly runtime: StoredValue<HostRuntime | null>;
};

type ResourceUsageTrackerCreationOptions = {
    readonly samplingIntervalMilliseconds: number;
};

type HostTaskRunOptions = {
    readonly name: string;
    readonly signal: AbortSignal;
    readonly transferList: readonly unknown[];
};

type RuntimeFailureContext = {
    readonly child: SupervisedChildProcess;
    readonly configured: CompletionSignal;
    readonly finished: CompletionSignal;
    readonly state: HostedWorkerPoolState;
};

function nextTaskId(): string {
    return `worker-pool-task-${randomUUID()}`;
}

function signalNotReady(): never {
    throw new Error('Hosted worker-pool signal was used before initialization.');
}

function createCompletionSignal(): CompletionSignal {
    let resolveSignal: () => void = signalNotReady;
    let rejectSignal: (error: Error) => void = signalNotReady;
    const promise = new Promise<void>(function createSignal(resolve, reject) {
        resolveSignal = resolve;
        rejectSignal = reject;
    });

    return {
        promise,
        reject(error) {
            rejectSignal(error);
        },
        resolve() {
            resolveSignal();
        }
    };
}

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

function createPendingHostTasks(): PendingHostTasks {
    const tasks = new Map<string, PendingHostTask>();

    return {
        clear() {
            tasks.clear();
        },
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

function createResourceUsageSamples(): ResourceUsageSamples {
    const samples: ResourceUsageSnapshot[] = [];

    return {
        clear() {
            samples.length = 0;
        },
        hasAny() {
            return samples.length > 0;
        },
        push(sample) {
            samples.push(sample);
        },
        read() {
            return samples;
        }
    };
}

function createHostedWorkerPoolState(): HostedWorkerPoolState {
    return {
        outputSink: createStoredValue<WorkerPoolHostOutputSink | null>(null),
        pendingTasks: createPendingHostTasks(),
        resourceUsage: {
            sampleListener: createStoredValue<((sample: ResourceUsageSnapshot) => void) | null>(null),
            resolveFirstSample: createStoredValue<(() => void) | null>(null),
            samples: createResourceUsageSamples(),
            start: createStoredValue<Promise<void> | null>(null)
        },
        runtime: createStoredValue<HostRuntime | null>(null)
    };
}

function sendCommand(child: SupervisedChildProcess | undefined, command: WorkerPoolHostCommand): void {
    child?.send(childProcessEnvelope(workerPoolHostCorrelationId, command));
}

function taskWithoutPort(task: WorkerPoolTask): WorkerPoolTaskWithoutPort {
    if (task.kind === 'collect') {
        return {
            command: task.command,
            kind: 'collect'
        };
    }

    return {
        assignedWork: task.assignedWork,
        command: task.command,
        kind: 'run',
        startedAtMilliseconds: task.startedAtMilliseconds
    };
}

function createResourceUsage(samples: readonly ResourceUsageSnapshot[]): RunResourceUsage {
    const first = samples[0];
    const last = samples.at(-1);

    if (first === undefined || last === undefined) {
        throw new Error('Hosted worker-pool resource tracking did not receive samples.');
    }

    return createResourceUsageFromSamples(first, last, samples);
}

function observeChildOutput(
    child: SupervisedChildProcess,
    readOutputSink: () => WorkerPoolHostOutputSink | null
): void {
    child.stdout?.on('data', function writeStdout(chunk: Uint8Array) {
        readOutputSink()?.('stdout', chunk);
    });
    child.stderr?.on('data', function writeStderr(chunk: Uint8Array) {
        readOutputSink()?.('stderr', chunk);
    });
}

function rejectPendingTasks(state: HostedWorkerPoolState, error: Error): void {
    for (const pendingTask of state.pendingTasks.values()) {
        pendingTask.reject(error);
    }

    state.pendingTasks.clear();
}

function handleTaskResult(
    state: HostedWorkerPoolState,
    message: Extract<WorkerPoolHostMessage, { readonly kind: 'task-result'; }>
): void {
    const pendingTask = state.pendingTasks.get(message.taskId);

    state.pendingTasks.delete(message.taskId);
    pendingTask?.resolve(message.result);
}

function handleTaskError(
    state: HostedWorkerPoolState,
    message: Extract<WorkerPoolHostMessage, { readonly kind: 'task-error'; }>
): void {
    const pendingTask = state.pendingTasks.get(message.taskId);

    state.pendingTasks.delete(message.taskId);
    pendingTask?.reject(deserializeError(message.error));
}

function handleTaskMessage(
    state: HostedWorkerPoolState,
    message: Extract<WorkerPoolHostMessage, { readonly kind: 'task-message'; }>
): void {
    state
        .pendingTasks
        .get(message.taskId)
        ?.port
        .postMessage(deserializeWorkerPoolMessage(message.message), []);
}

function handleResourceSample(
    state: HostedWorkerPoolState,
    message: Extract<WorkerPoolHostMessage, { readonly kind: 'resource-sample'; }>
): void {
    state.resourceUsage.samples.push(message.sample);
    state.resourceUsage.sampleListener.read()?.(message.sample);
    state.resourceUsage.resolveFirstSample.read()?.();
    state.resourceUsage.resolveFirstSample.write(null);
}

function handleHostMessage(state: HostedWorkerPoolState, message: WorkerPoolHostMessage): void {
    if (message.kind === 'resource-sample') {
        handleResourceSample(state, message);
    } else if (message.kind === 'task-error') {
        handleTaskError(state, message);
    } else if (message.kind === 'task-message') {
        handleTaskMessage(state, message);
    } else if (message.kind === 'task-result') {
        handleTaskResult(state, message);
    }
}

function hostNodeArguments(options: WorkerPoolCreationOptions): readonly string[] {
    return options.hostProcess.kind === 'child' ? options.hostProcess.nodeArguments : [];
}

function handleRuntimeFailure(
    context: RuntimeFailureContext,
    error: Error
): void {
    if (context.state.runtime.read()?.child === context.child) {
        context.state.runtime.write(null);
    }

    context.configured.reject(error);
    rejectPendingTasks(context.state, error);
    context.finished.resolve();
}

function createRuntime(input: HostedWorkerPoolInput, state: HostedWorkerPoolState): HostRuntime {
    const child = input.startWorkerPoolHost({
        cwd: input.options.cwd,
        environmentVariables: input.environmentVariables,
        nodeArguments: hostNodeArguments(input.options)
    });
    const configured = createCompletionSignal();
    const finished = createCompletionSignal();
    const failureContext = { child, configured, finished, state };

    child.on('message', function receiveMessage(message: unknown) {
        const hostMessage = envelopeMessage<WorkerPoolHostMessage>(message, workerPoolHostCorrelationId);

        if (hostMessage?.kind === 'configured') {
            configured.resolve();
        } else if (hostMessage !== null) {
            handleHostMessage(state, hostMessage);
        }
    });
    observeChildOutput(child, function readOutputSink() {
        return state.outputSink.read();
    });
    child.on('error', function rejectTasks(error: Error) {
        handleRuntimeFailure(failureContext, error);
    });
    child.on('exit', function rejectTasksAfterExit() {
        handleRuntimeFailure(
            failureContext,
            new Error('Hosted worker-pool process exited.')
        );
    });
    sendCommand(child, { kind: 'configure', options: input.options });

    return { child, configured: configured.promise, finished: finished.promise };
}

async function activeRuntime(input: HostedWorkerPoolInput, state: HostedWorkerPoolState): Promise<HostRuntime> {
    const currentRuntime = state.runtime.read() ?? createRuntime(input, state);

    state.runtime.write(currentRuntime);
    await currentRuntime.configured;

    return currentRuntime;
}

function isWorkerPoolTask(value: unknown): value is WorkerPoolTask {
    return typeof value === 'object' &&
        value !== null &&
        Object.hasOwn(value, 'kind') &&
        Object.hasOwn(value, 'port') &&
        (Reflect.get(value, 'kind') === 'collect' || Reflect.get(value, 'kind') === 'run');
}

function readWorkerPoolTask(value: unknown): WorkerPoolTask {
    if (!isWorkerPoolTask(value)) {
        throw new Error('Hosted worker-pool received an invalid task.');
    }

    return value;
}

async function requestHostResourceTracking(
    input: HostedWorkerPoolInput,
    state: HostedWorkerPoolState,
    options: ResourceUsageTrackerCreationOptions
): Promise<void> {
    const hostRuntime = await activeRuntime(input, state);

    sendCommand(hostRuntime.child, {
        kind: 'start-resource-tracking',
        samplingIntervalMilliseconds: options.samplingIntervalMilliseconds
    });
}

async function waitForHostResourceTrackingStart(
    input: HostedWorkerPoolInput,
    state: HostedWorkerPoolState,
    options: ResourceUsageTrackerCreationOptions,
    firstSample: Promise<void>
): Promise<void> {
    await requestHostResourceTracking(input, state, options);
    await firstSample;
}

function createTracker(
    input: HostedWorkerPoolInput,
    state: HostedWorkerPoolState,
    options: ResourceUsageTrackerCreationOptions
): HostResourceUsageTracker {
    return {
        finish() {
            state.resourceUsage.sampleListener.write(null);
            state.resourceUsage.start.write(null);
            sendCommand(state.runtime.read()?.child, { kind: 'finish-resource-tracking' });

            return createResourceUsage(state.resourceUsage.samples.read());
        },
        start(onSample) {
            state.resourceUsage.samples.clear();
            state.resourceUsage.sampleListener.write(onSample ?? null);
            const firstSample = new Promise<void>(function waitForFirstSample(resolve) {
                state.resourceUsage.resolveFirstSample.write(resolve);
            });

            state.resourceUsage.start.write(waitForHostResourceTrackingStart(input, state, options, firstSample));
        },
        async waitForStart() {
            if (state.resourceUsage.samples.hasAny()) {
                return;
            }

            await state.resourceUsage.start.read();
        }
    };
}

async function destroyHostedPool(state: HostedWorkerPoolState): Promise<void> {
    const closingRuntime = state.runtime.read();

    if (closingRuntime === null) {
        return;
    }

    sendCommand(closingRuntime.child, { kind: 'destroy' });
    state.runtime.write(null);
    await closingRuntime.finished;
}

async function runHostedTask(
    input: HostedWorkerPoolInput,
    state: HostedWorkerPoolState,
    task: unknown,
    options: HostTaskRunOptions
): Promise<unknown> {
    const taskId = nextTaskId();
    const workerPoolTask = readWorkerPoolTask(task);
    const hostRuntime = await activeRuntime(input, state);

    function abortHostTask(): void {
        sendCommand(hostRuntime.child, { kind: 'abort-task', taskId });
    }

    try {
        return await new Promise(function waitForHostTask(resolve, reject) {
            state.pendingTasks.set(taskId, {
                port: workerPoolTask.port,
                reject,
                resolve
            });
            options.signal.addEventListener('abort', abortHostTask, { once: true });
            sendCommand(hostRuntime.child, {
                kind: 'run-task',
                task: taskWithoutPort(workerPoolTask),
                taskId
            });
        });
    } finally {
        options.signal.removeEventListener('abort', abortHostTask);
    }
}

export function createWorkerPoolHostProcessStarter(
    dependencies: WorkerPoolHostProcessStarterDependencies
): WorkerPoolHostProcessStarter {
    return function startWorkerPoolHost(options: WorkerPoolHostProcessStartOptions) {
        return dependencies.fork(
            dependencies.childProcessEntryPoint,
            [ childRoleArgument(workerPoolHostRole) ],
            {
                cwd: options.cwd,
                env: sanitizedChildEnvironment(options.environmentVariables),
                execArgv: Array.from(options.nodeArguments),
                stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ]
            }
        );
    };
}

export function createHostedWorkerPool(input: HostedWorkerPoolInput): CreatedWorkerPool {
    const state = createHostedWorkerPoolState();

    return {
        createResourceUsageTracker(options) {
            return createTracker(input, state, options);
        },
        async destroy() {
            return destroyHostedPool(state);
        },
        options: {
            isolateWorkers: input.options.workerLifecycle === 'fresh-worker-per-unit',
            maxThreads: input.options.workerCount
        },
        async run(task, options) {
            return runHostedTask(input, state, task, options);
        },
        setHostOutputSink(sink) {
            state.outputSink.write(sink);
        }
    };
}
