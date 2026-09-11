import {
    MessageChannel as NodeMessageChannel,
    type MessagePort as NodeMessagePort
} from 'node:worker_threads';
import { RunCollectionError } from './run-errors.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    createStoredRunValue,
    type StoredRunValue,
    type SupervisedRunState
} from './supervised-run-state.ts';
import type { TinypoolInstance } from './tinypool-node-compatibility.ts';
import {
    createPool,
    type WorkerPoolCollectionResult
} from './worker-pool-runtime.ts';
import type {
    WorkerPoolCollection,
    WorkerPoolCommand,
    WorkerPoolMessage
} from './worker-pool-protocol.ts';

function portTransferList(port: NodeMessagePort): readonly NodeMessagePort[] {
    return [ port ];
}

function recordCollectionOutput(message: WorkerPoolMessage, runState: SupervisedRunState): void {
    if (message.kind === 'output') {
        runState.recordCapturedOutput(
            message.stream,
            Buffer.from(message.chunk),
            message.capturedAtMilliseconds
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

type CollectionRuntime = {
    readonly controller: AbortController;
    readonly pool: TinypoolInstance;
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
            attributedTo: null,
            cause: { reason: 'Worker-pool collection exceeded collection timeout.' },
            message: 'Worker-pool collection exceeded collection timeout.',
            subtype: 'crash'
        });
        context.controller.abort();
    }, context.command.collectionTimeoutMilliseconds);
}

async function runCollectionTask(
    pool: TinypoolInstance,
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
    command: WorkerPoolCommand,
    dependencies: RunOrchestratorDependencies,
    runState: SupervisedRunState
): CollectionRuntime {
    const { port1, port2 } = new NodeMessageChannel();
    const controller = new AbortController();
    const terminalFailure = createStoredRunValue(false);
    const timeout = startCollectionTimeout({ command, controller, dependencies, runState, terminalFailure });

    observeCollectionOutput(port2, runState);

    return {
        controller,
        pool: createPool(1),
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

export async function collectInWorkerPool(
    command: WorkerPoolCommand,
    dependencies: RunOrchestratorDependencies,
    runState: SupervisedRunState
): Promise<WorkerPoolCollectionResult> {
    const runtime = createCollectionRuntime(command, dependencies, runState);

    try {
        return completeCollection(
            await runCollectionTask(runtime.pool, command, runtime.port1, runtime.controller),
            runtime,
            runState
        );
    } catch (error: unknown) {
        throw collectionError(error, runState);
    } finally {
        dependencies.wallClock.clearTimeout(runtime.timeout);
        runtime.port2.close();
        await runtime.pool.destroy();
    }
}
