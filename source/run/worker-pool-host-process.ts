import { randomUUID } from 'node:crypto';
import type { RunProcessUsage, RunProcessUsageTracker, ProcessUsageSnapshot } from '../engine/process-usage.ts';
import { observeHostTransport, sendHostCommand } from './worker-pool-host-transport.ts';
import type { RuntimeCapabilityPolicyEnvironment } from './capability-policy-snapshots.ts';
import {
    createHostRunnerErrors,
    type CreatedWorkerPool,
    type HostRunnerErrors,
    type WorkerPoolCreationOptions,
    type WorkerPoolHostOutputSink,
    type WorkerPoolHostProcessStarter
} from './run-orchestrator-dependencies.ts';
import { createProcessUsageFromSamples } from './process-usage.ts';
import type { SupervisedChildProcess } from './supervised-child-process.ts';
import {
    deserializeError,
    deserializeWorkerPoolMessage,
    type WorkerPoolHostCommand,
    type WorkerPoolHostMessage
} from './worker-pool-host-protocol.ts';
import {
    readWorkerPoolTask,
    readWorkerPoolTaskWithoutPort,
    type WorkerPoolTaskPort
} from './worker-pool-host-task.ts';
import {
    createCompletionSignal,
    type CompletionSignal
} from './worker-pool-host-signal.ts';

type WorkerPoolPreparationReply = Extract<WorkerPoolHostCommand, { readonly kind: 'task-reply'; }>['reply'];

const microsecondsPerMillisecond = 1000;

type PendingHostTask = {
    readonly port: WorkerPoolTaskPort;
    readonly reject: (error: unknown) => void;
    readonly resolve: (value: unknown) => void;
};

type HostProcessUsageTracker = RunProcessUsageTracker & {
    readonly waitForStart: () => Promise<void>;
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

type ProcessUsageSamples = {
    readonly clear: () => void;
    readonly hasAny: () => boolean;
    readonly push: (sample: ProcessUsageSnapshot) => void;
    readonly read: () => readonly ProcessUsageSnapshot[];
};

type HostProcessUsageTrackingState = {
    readonly sampleListener: StoredValue<((sample: ProcessUsageSnapshot) => void) | null>;
    readonly resolveFirstSample: StoredValue<(() => void) | null>;
    readonly samples: ProcessUsageSamples;
    readonly start: StoredValue<Promise<void> | null>;
};

type HostedWorkerPoolState = {
    readonly hostRunnerErrors: HostRunnerErrors;
    readonly outputSink: StoredValue<WorkerPoolHostOutputSink | null>;
    readonly pendingTasks: PendingHostTasks;
    readonly processUsage: HostProcessUsageTrackingState;
    readonly runtime: StoredValue<HostRuntime | null>;
};

type ProcessUsageTrackerCreationOptions = {
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

type RuntimeObservationInput = RuntimeFailureContext & {
    readonly input: HostedWorkerPoolInput;
    readonly startupStartedAtMicroseconds: number | null;
};

function nextTaskId(): string {
    return `worker-pool-task-${randomUUID()}`;
}

function currentPerformanceMicroseconds(): number {
    return Math.trunc(performance.now() * microsecondsPerMillisecond);
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

function createProcessUsageSamples(): ProcessUsageSamples {
    const samples: ProcessUsageSnapshot[] = [];

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
        hostRunnerErrors: createHostRunnerErrors(),
        outputSink: createStoredValue<WorkerPoolHostOutputSink | null>(null),
        pendingTasks: createPendingHostTasks(),
        processUsage: {
            sampleListener: createStoredValue<((sample: ProcessUsageSnapshot) => void) | null>(null),
            resolveFirstSample: createStoredValue<(() => void) | null>(null),
            samples: createProcessUsageSamples(),
            start: createStoredValue<Promise<void> | null>(null)
        },
        runtime: createStoredValue<HostRuntime | null>(null)
    };
}

function sendCommand(child: SupervisedChildProcess | undefined, command: WorkerPoolHostCommand): void {
    if (child !== undefined) {
        sendHostCommand(child, command);
    }
}

function createProcessUsage(samples: readonly ProcessUsageSnapshot[]): RunProcessUsage {
    const first = samples[0];
    const last = samples.at(-1);

    if (first === undefined || last === undefined) {
        throw new Error('Hosted worker-pool process usage tracking did not receive samples.');
    }

    return createProcessUsageFromSamples(first, last, samples);
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

function handleProcessUsageSample(
    state: HostedWorkerPoolState,
    message: Extract<WorkerPoolHostMessage, { readonly kind: 'process-usage-sample'; }>
): void {
    state.processUsage.samples.push(message.sample);
    state.processUsage.sampleListener.read()?.(message.sample);
    state.processUsage.resolveFirstSample.read()?.();
    state.processUsage.resolveFirstSample.write(null);
}

function handleHostRunnerError(
    state: HostedWorkerPoolState,
    message: Extract<WorkerPoolHostMessage, { readonly kind: 'runner-error'; }>
): void {
    state.hostRunnerErrors.push(message.error);
}

function handleHostMessage(state: HostedWorkerPoolState, message: WorkerPoolHostMessage): void {
    if (message.kind === 'process-usage-sample') {
        handleProcessUsageSample(state, message);
    } else if (message.kind === 'runner-error') {
        handleHostRunnerError(state, message);
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
    context.state.processUsage.resolveFirstSample.read()?.();
    context.state.processUsage.resolveFirstSample.write(null);
}

function recordHostStartup(
    input: HostedWorkerPoolInput,
    child: SupervisedChildProcess,
    startedAtMicroseconds: number | null
): void {
    if (startedAtMicroseconds !== null) {
        input.options.timing?.record({
            completedAtMicroseconds: currentPerformanceMicroseconds(),
            kind: 'host.entry-startup',
            metadata: {
                label: null,
                processId: String(child.pid ?? ''),
                resource: null,
                workerId: null
            },
            startedAtMicroseconds,
            status: 'success'
        });
    }
}

function observeRuntime(observation: RuntimeObservationInput): void {
    observeChildOutput(observation.child, function readOutputSink() {
        return observation.state.outputSink.read();
    });
    observeHostTransport({
        child: observation.child,
        configured() {
            recordHostStartup(observation.input, observation.child, observation.startupStartedAtMicroseconds);
            observation.configured.resolve();
        },
        failed(error) {
            observation.state.hostRunnerErrors.push({
                attributedTo: null,
                attributedToAttempt: null,
                attributedToWork: null,
                cause: error,
                diagnostics: [],
                message: error.message,
                subtype: 'crash'
            });
            handleRuntimeFailure(observation, error);
        },
        finished() {
            rejectPendingTasks(observation.state, new Error('Hosted worker-pool process closed.'));
            observation.finished.resolve();
        },
        hasTask(taskId) {
            return observation.state.pendingTasks.get(taskId) !== undefined;
        },
        receive(message) {
            handleHostMessage(observation.state, message);
        }
    });
}

function createRuntime(input: HostedWorkerPoolInput, state: HostedWorkerPoolState): HostRuntime {
    const startupStartedAtMicroseconds = input.options.timing === undefined || input.options.timing === null
        ? null
        : currentPerformanceMicroseconds();
    const child = input.startWorkerPoolHost({
        cwd: input.options.cwd,
        environmentVariables: input.environmentVariables,
        nodeArguments: hostNodeArguments(input.options),
        testFamily: input.options.testFamily
    });
    const configured = createCompletionSignal();
    const finished = createCompletionSignal();
    observeRuntime({
        child,
        configured,
        finished,
        input,
        startupStartedAtMicroseconds,
        state
    });
    sendCommand(child, {
        kind: 'configure',
        options: {
            cwd: input.options.cwd,
            hostProcess: input.options.hostProcess,
            testFamily: input.options.testFamily,
            workerCount: input.options.workerCount,
            workerLifecycle: input.options.workerLifecycle
        }
    });

    return { child, configured: configured.promise, finished: finished.promise };
}

async function activeRuntime(input: HostedWorkerPoolInput, state: HostedWorkerPoolState): Promise<HostRuntime> {
    const currentRuntime = state.runtime.read() ?? createRuntime(input, state);

    state.runtime.write(currentRuntime);
    await currentRuntime.configured;

    return currentRuntime;
}

async function requestHostProcessUsageTracking(
    input: HostedWorkerPoolInput,
    state: HostedWorkerPoolState,
    options: ProcessUsageTrackerCreationOptions
): Promise<void> {
    const hostRuntime = await activeRuntime(input, state);

    sendCommand(hostRuntime.child, {
        kind: 'start-process-usage-tracking',
        samplingIntervalMilliseconds: options.samplingIntervalMilliseconds
    });
}

async function waitForHostProcessUsageTrackingStart(
    input: HostedWorkerPoolInput,
    state: HostedWorkerPoolState,
    options: ProcessUsageTrackerCreationOptions,
    firstSample: Promise<void>
): Promise<void> {
    await requestHostProcessUsageTracking(input, state, options);
    await firstSample;
}

function createTracker(
    input: HostedWorkerPoolInput,
    state: HostedWorkerPoolState,
    options: ProcessUsageTrackerCreationOptions
): HostProcessUsageTracker {
    return {
        finish() {
            state.processUsage.sampleListener.write(null);
            state.processUsage.start.write(null);
            sendCommand(state.runtime.read()?.child, { kind: 'finish-process-usage-tracking' });

            return createProcessUsage(state.processUsage.samples.read());
        },
        start(onSample) {
            state.processUsage.samples.clear();
            state.processUsage.sampleListener.write(onSample ?? null);
            const firstSample = new Promise<void>(function waitForFirstSample(resolve) {
                state.processUsage.resolveFirstSample.write(resolve);
            });

            state.processUsage.start.write(waitForHostProcessUsageTrackingStart(input, state, options, firstSample));
        },
        async waitForStart() {
            if (state.processUsage.samples.hasAny()) {
                return;
            }

            await state.processUsage.start.read();
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

    function forwardPreparationReply(reply: WorkerPoolPreparationReply): void {
        sendCommand(hostRuntime.child, { kind: 'task-reply', taskId, reply });
    }
    workerPoolTask.port.on('message', forwardPreparationReply);
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
                task: readWorkerPoolTaskWithoutPort(workerPoolTask),
                taskId
            });
        });
    } finally {
        options.signal.removeEventListener('abort', abortHostTask);
        workerPoolTask.port.off('message', forwardPreparationReply);
    }
}

export function createHostedWorkerPool(input: HostedWorkerPoolInput): CreatedWorkerPool {
    const state = createHostedWorkerPoolState();

    return {
        createProcessUsageTracker(options) {
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
        },
        takeHostRunnerErrors() {
            return state.hostRunnerErrors.take();
        }
    };
}
