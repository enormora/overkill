import {
    MessageChannel as NodeMessageChannel,
    type MessagePort as NodeMessagePort
} from 'node:worker_threads';
import { RunCollectionError } from './run-errors.ts';
import type {
    CreatedWorkerPool,
    RunOrchestratorDependencies
} from './run-orchestrator-dependencies.ts';
import {
    createStoredRunValue,
    type StoredRunValue,
    type SupervisedRunState
} from './supervised-run-state.ts';
import type { WorkerPoolCollectionResult } from './worker-pool-runtime.ts';
import type {
    WorkerPoolCollection,
    WorkerPoolCommand,
    WorkerPoolMessage
} from './worker-pool-protocol.ts';
import {
    emptyTimingSpanMetadata,
    instantTimingSpanObservation,
    type RunTimingMeasurement
} from './run-timing-collection.ts';

function portTransferList(port: NodeMessagePort): readonly NodeMessagePort[] {
    return [ port ];
}

function recordCollectionOutput(message: WorkerPoolMessage, runState: SupervisedRunState): void {
    if (message.kind === 'output') {
        runState.recordCapturedOutput(
            message.stream,
            Buffer.from(message.chunk),
            message.capturedAtMicroseconds
        );
    }
}

function collectionError(error: unknown, runState: SupervisedRunState): RunCollectionError {
    const [ firstError ] = runState.runnerErrors();

    return new RunCollectionError(
        firstError?.message ?? 'Worker-pool collection failed.',
        { cause: firstError ?? error },
        'loader'
    );
}

function isWorkerPoolCollection(value: unknown): value is WorkerPoolCollection {
    return value !== null &&
        typeof value === 'object' &&
        Object.hasOwn(value, 'collectedPlan') &&
        Object.hasOwn(value, 'runnerErrors');
}

type CollectionTimeoutContext = {
    readonly command: WorkerPoolCommand;
    readonly controller: AbortController;
    readonly dependencies: RunOrchestratorDependencies;
    readonly runState: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
};

export type WorkerPoolCollectionInput = {
    readonly command: WorkerPoolCommand;
    readonly createdPool: CreatedWorkerPool | null;
    readonly dependencies: RunOrchestratorDependencies;
    readonly runState: SupervisedRunState;
    readonly timing: RunTimingMeasurement | null;
};

type CollectionRuntime = {
    readonly destroyPool: boolean;
    readonly controller: AbortController;
    readonly pool: CreatedWorkerPool;
    readonly port1: NodeMessagePort;
    readonly port2: NodeMessagePort;
    readonly terminalFailure: StoredRunValue<boolean>;
    readonly timeout: ReturnType<RunOrchestratorDependencies['wallClock']['setTimeout']>;
};

function startCollectionTimeout(
    context: CollectionTimeoutContext
): ReturnType<RunOrchestratorDependencies['wallClock']['setTimeout']> {
    return context.dependencies.wallClock.setTimeout(function abortCollection() {
        context.terminalFailure.write(true);
        context.runState.recordRunnerError({
            attributedToAttempt: null,
            attributedTo: null,
            attributedToWork: null,
            cause: { reason: 'Worker-pool collection exceeded collection timeout.' },
            diagnostics: [ { label: 'reason', value: 'Worker-pool collection exceeded collection timeout.' } ],
            message: 'Worker-pool collection exceeded collection timeout.',
            subtype: 'crash'
        });
        context.controller.abort();
    }, context.command.collectionTimeoutMilliseconds);
}

async function runCollectionTask(
    pool: CreatedWorkerPool,
    command: WorkerPoolCommand,
    port: NodeMessagePort,
    controller: AbortController
): Promise<WorkerPoolCollection> {
    const collection: unknown = await pool.run({
        command,
        kind: 'collect',
        port
    }, {
        name: 'runTask',
        signal: controller.signal,
        transferList: portTransferList(port)
    });

    if (!isWorkerPoolCollection(collection)) {
        throw new RunCollectionError('Worker-pool collection failed.', { cause: collection }, 'loader');
    }

    return collection;
}

function observeCollectionOutput(port: NodeMessagePort, runState: SupervisedRunState): void {
    port.on('message', function receiveCollectionMessage(message: WorkerPoolMessage) {
        recordCollectionOutput(message, runState);
    });
}

function createCollectionRuntime(
    input: WorkerPoolCollectionInput
): CollectionRuntime {
    const { port1, port2 } = new NodeMessageChannel();
    const controller = new AbortController();
    const terminalFailure = createStoredRunValue(false);
    const timeout = startCollectionTimeout({
        command: input.command,
        controller,
        dependencies: input.dependencies,
        runState: input.runState,
        terminalFailure
    });

    observeCollectionOutput(port2, input.runState);
    const timingOption = input.timing === null ? {} : { timing: input.timing };
    const poolOptions = {
        cwd: input.command.cwd,
        hostProcess: input.command.hostProcess,
        testFamily: input.command.testFamily,
        ...timingOption,
        workerCount: 1,
        workerLifecycle: 'fresh-worker-per-unit' as const
    };
    const pool = input.createdPool ?? input.timing?.measure(
        'worker-pool.start',
        emptyTimingSpanMetadata(),
        function createTimedCollectionWorkerPool() {
            return input.dependencies.createWorkerPool(poolOptions);
        }
    ) ?? input.dependencies.createWorkerPool(poolOptions);
    pool.setHostOutputSink?.(function recordHostOutput(stream, chunk) {
        input.runState.recordCapturedOutput(
            stream,
            chunk,
            Number(input.dependencies.wallClock.currentMonotonicMicroseconds)
        );
    });

    return {
        controller,
        destroyPool: input.createdPool === null,
        pool,
        port1,
        port2,
        terminalFailure,
        timeout
    };
}

function collectionResult(
    collection: WorkerPoolCollection,
    runState: SupervisedRunState
): WorkerPoolCollectionResult {
    return {
        collectedPlan: collection.collectedPlan,
        runnerErrors: [ ...runState.runnerErrors(), ...collection.runnerErrors ]
    };
}

function completeCollection(
    collection: WorkerPoolCollection,
    runtime: CollectionRuntime,
    runState: SupervisedRunState
): WorkerPoolCollectionResult {
    if (runtime.terminalFailure.read()) {
        throw new RunCollectionError('Worker-pool collection failed.', { cause: null }, 'loader');
    }

    return collectionResult(collection, runState);
}

async function destroyCollectionRuntime(
    input: WorkerPoolCollectionInput,
    runtime: CollectionRuntime
): Promise<void> {
    input.dependencies.wallClock.clearTimeout(runtime.timeout);
    runtime.port2.close();
    runtime.pool.setHostOutputSink?.(null);

    if (runtime.destroyPool) {
        await (input.timing?.measureAsync(
            'worker-pool.shutdown',
            emptyTimingSpanMetadata(),
            async function destroyTimedCollectionPool() {
                await runtime.pool.destroy();
            }
        ) ?? runtime.pool.destroy());
    }
}

async function collectWithRuntime(
    input: WorkerPoolCollectionInput,
    runtime: CollectionRuntime
): Promise<WorkerPoolCollectionResult> {
    input.timing?.record(instantTimingSpanObservation({
        kind: 'worker-pool.ready',
        metadata: emptyTimingSpanMetadata(),
        observedAtMicroseconds: Number(input.dependencies.wallClock.currentMonotonicMicroseconds),
        status: 'success'
    }));

    return completeCollection(
        await runCollectionTask(runtime.pool, input.command, runtime.port1, runtime.controller),
        runtime,
        input.runState
    );
}

export async function collectInWorkerPool(
    input: WorkerPoolCollectionInput
): Promise<WorkerPoolCollectionResult> {
    const runtime = createCollectionRuntime(input);

    try {
        return await collectWithRuntime(input, runtime);
    } catch (error: unknown) {
        throw collectionError(error, input.runState);
    } finally {
        await destroyCollectionRuntime(input, runtime);
    }
}
