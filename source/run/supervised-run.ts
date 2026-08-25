import type {
    ResourceUsageSnapshot,
    RunResult,
    RunnerError
} from '../packages/engine/engine.entry-point.ts';
import {
    collectedRunCaseIds
} from './collected-run-plan.ts';
import type {
    CollectedRunPlan,
    ResolvedRun,
    RunOrchestratorDependencies
} from './run-types.ts';
import type {
    SupervisedChildMessage,
    SupervisedCollectCommand,
    SupervisedRunCommand
} from './supervised-protocol.ts';
import {
    observeSupervisedChildOutput,
    startSupervisedChild,
    type SupervisedChildProcess
} from './supervised-child-process.ts';
import { RunCollectionError } from './run-errors.ts';
import {
    applyEvent,
    createHardTimeout,
    createReporterContext,
    createReporterEventQueue,
    finishSupervisedRuntime,
    handleChildMessage,
    handleCollectionSample,
    kill,
    observeChild,
    reportRunStart,
    sendAssignment,
    sendRunCommand,
    supervisedCollectedPlan,
    type SupervisedCollectionRuntime,
    type SupervisedRunRuntime
} from './supervised-run-runtime.ts';
import {
    createStoredRunValue,
    createSupervisedRunState,
    type StoredRunValue,
    type SupervisedRunState
} from './supervised-run-state.ts';

type SupervisedCollectionResult = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunnerError[];
};

type CreateResolvedRunFromCollection = (
    collection: SupervisedCollectionResult
) => ResolvedRun;

type Signal = {
    readonly promise: Promise<void>;
    readonly resolve: () => void;
};

type SupervisedLiveRun = {
    readonly child: SupervisedChildProcess;
    readonly collected: StoredRunValue<SupervisedCollectionResult | null>;
    readonly collectedSignal: Signal;
    readonly collectionTimeout: ReturnType<RunOrchestratorDependencies['wallClock']['setTimeout']>;
    readonly dependencies: RunOrchestratorDependencies;
    readonly finishedSignal: Signal;
    readonly previousSample: StoredRunValue<ResourceUsageSnapshot | null>;
    readonly runtime: StoredRunValue<SupervisedRunRuntime | null>;
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
};

function createSignal(): Signal {
    let resolveSignal: () => void = function missingSignalResolver() {
        return undefined;
    };
    const promise = new Promise<void>(function waitForSignal(resolve) {
        resolveSignal = resolve;
    });

    return { promise, resolve: resolveSignal };
}

function handleCollectionMessage(
    message: SupervisedChildMessage,
    runtime: SupervisedCollectionRuntime<SupervisedCollectionResult | null>
): void {
    if (message.kind === 'collected') {
        runtime.collected.write({
            collectedPlan: message.collectedPlan,
            runnerErrors: message.runnerErrors
        });
    } else if (message.kind === 'event') {
        applyEvent(message.event, runtime.state, new Map());
    } else if (message.kind === 'sample') {
        handleCollectionSample(message.sample, runtime);
    }
}

async function observeCollection(
    runtime: SupervisedCollectionRuntime<SupervisedCollectionResult | null>
): Promise<void> {
    observeSupervisedChildOutput(runtime);

    return new Promise(function waitForCollectionChild(resolve) {
        const collectionTimeout = runtime.dependencies.wallClock.setTimeout(function killTimedOutCollection() {
            runtime.terminalFailure.write(true);
            runtime.state.recordRunnerError({
                attributedTo: null,
                cause: { reason: 'Supervised collection exceeded collection timeout.' },
                message: 'Supervised collection exceeded collection timeout.',
                subtype: 'crash'
            });
            kill(runtime.child);
        }, runtime.command.collectionTimeoutMilliseconds);

        runtime.child.on('message', function receiveMessage(message: SupervisedChildMessage) {
            handleCollectionMessage(message, runtime);
        });
        runtime.child.on('error', function recordChildError(error) {
            runtime.terminalFailure.write(true);
            runtime.state.recordRunnerError({
                attributedTo: null,
                cause: error,
                message: error.message,
                subtype: 'crash'
            });
        });
        runtime.child.on('exit', function resolveExit() {
            runtime.dependencies.wallClock.clearTimeout(collectionTimeout);
            resolve();
        });
    });
}

async function createCollectionRuntime(
    command: SupervisedCollectCommand | SupervisedRunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<SupervisedCollectionRuntime<SupervisedCollectionResult | null>> {
    return {
        child: await startSupervisedChild({
            capabilityRestrictions: command.capabilityRestrictions,
            cwd: command.cwd
        }, dependencies),
        command,
        collected: createStoredRunValue<SupervisedCollectionResult | null>(null),
        dependencies,
        previousSample: createStoredRunValue<ResourceUsageSnapshot | null>(null),
        state: createSupervisedRunState(),
        terminalFailure: createStoredRunValue(false)
    };
}

function readCollectedResult(
    runtime: SupervisedCollectionRuntime<SupervisedCollectionResult | null>
): SupervisedCollectionResult {
    const collected = runtime.collected.read();

    if (collected !== null && !runtime.terminalFailure.read()) {
        return {
            collectedPlan: collected.collectedPlan,
            runnerErrors: [ ...runtime.state.runnerErrors(), ...collected.runnerErrors ]
        };
    }

    const [ firstError ] = runtime.state.runnerErrors();

    throw new RunCollectionError(
        firstError?.message ?? 'Supervised collection failed.',
        { cause: firstError ?? null },
        'loader'
    );
}

function recordCollectionTimeout(
    child: SupervisedChildProcess,
    state: SupervisedRunState,
    terminalFailure: StoredRunValue<boolean>,
    collectedSignal: Signal
): void {
    terminalFailure.write(true);
    state.recordRunnerError({
        attributedTo: null,
        cause: { reason: 'Supervised collection exceeded collection timeout.' },
        message: 'Supervised collection exceeded collection timeout.',
        subtype: 'crash'
    });
    kill(child);
    collectedSignal.resolve();
}

async function createLiveRun(
    command: SupervisedRunCommand,
    dependencies: RunOrchestratorDependencies
): Promise<SupervisedLiveRun> {
    const child = await startSupervisedChild({
        capabilityRestrictions: command.capabilityRestrictions,
        cwd: command.cwd
    }, dependencies);
    const collectedSignal = createSignal();
    const state = createSupervisedRunState();
    const terminalFailure = createStoredRunValue(false);
    const collectionTimeout = dependencies.wallClock.setTimeout(function killTimedOutCollection() {
        recordCollectionTimeout(child, state, terminalFailure, collectedSignal);
    }, command.collectionTimeoutMilliseconds);

    return {
        child,
        collected: createStoredRunValue<SupervisedCollectionResult | null>(null),
        collectedSignal,
        collectionTimeout,
        dependencies,
        finishedSignal: createSignal(),
        previousSample: createStoredRunValue<ResourceUsageSnapshot | null>(null),
        runtime: createStoredRunValue<SupervisedRunRuntime | null>(null),
        state,
        terminalFailure
    };
}

function collectionRuntime(
    command: SupervisedRunCommand,
    liveRun: SupervisedLiveRun
): SupervisedCollectionRuntime<SupervisedCollectionResult | null> {
    return {
        child: liveRun.child,
        collected: liveRun.collected,
        command,
        dependencies: liveRun.dependencies,
        previousSample: liveRun.previousSample,
        state: liveRun.state,
        terminalFailure: liveRun.terminalFailure
    };
}

function handleLiveCollectionMessage(
    message: SupervisedChildMessage,
    command: SupervisedRunCommand,
    liveRun: SupervisedLiveRun
): void {
    if (message.kind === 'collected') {
        liveRun.dependencies.wallClock.clearTimeout(liveRun.collectionTimeout);
        liveRun.collected.write({
            collectedPlan: message.collectedPlan,
            runnerErrors: message.runnerErrors
        });
        liveRun.collectedSignal.resolve();
    } else if (message.kind === 'sample') {
        handleCollectionSample(message.sample, collectionRuntime(command, liveRun));
    } else if (message.kind === 'event') {
        applyEvent(message.event, liveRun.state, new Map());
    }
}

function handleLiveMessage(
    message: SupervisedChildMessage,
    command: SupervisedRunCommand,
    liveRun: SupervisedLiveRun
): void {
    const runtime = liveRun.runtime.read();

    if (runtime === null) {
        handleLiveCollectionMessage(message, command, liveRun);
    } else {
        handleChildMessage(message, runtime);
    }
}

function observeLiveRun(command: SupervisedRunCommand, liveRun: SupervisedLiveRun): void {
    observeSupervisedChildOutput(liveRun);
    liveRun.child.on('message', function receiveMessage(message: SupervisedChildMessage) {
        handleLiveMessage(message, command, liveRun);
    });
    liveRun.child.on('error', function recordChildError(error) {
        liveRun.terminalFailure.write(true);
        liveRun.state.recordRunnerError({
            attributedTo: null,
            cause: error,
            message: error.message,
            subtype: 'crash'
        });
        liveRun.collectedSignal.resolve();
    });
    liveRun.child.on('exit', function resolveExit() {
        liveRun.dependencies.wallClock.clearTimeout(liveRun.collectionTimeout);
        liveRun.collectedSignal.resolve();
        liveRun.finishedSignal.resolve();
    });
}

async function readLiveCollection(liveRun: SupervisedLiveRun): Promise<SupervisedCollectionResult> {
    await liveRun.collectedSignal.promise;
    const collection = liveRun.collected.read();

    if (collection !== null && !liveRun.terminalFailure.read()) {
        return collection;
    }

    await liveRun.finishedSignal.promise;
    throw new RunCollectionError(
        liveRun.state.runnerErrors()[0]?.message ?? 'Supervised collection failed.',
        { cause: liveRun.state.runnerErrors()[0] ?? null },
        'loader'
    );
}

function createLiveRunRuntime(liveRun: SupervisedLiveRun, resolvedRun: ResolvedRun): SupervisedRunRuntime {
    const runtimeWithoutTimeout = {
        child: liveRun.child,
        collectedPlan: createStoredRunValue<CollectedRunPlan | null>(supervisedCollectedPlan(resolvedRun)),
        completedResult: createStoredRunValue<RunResult | null>(null),
        dependencies: liveRun.dependencies,
        previousSample: liveRun.previousSample,
        reporterContext: createReporterContext(resolvedRun),
        reporterEvents: createReporterEventQueue(),
        resolvedRun,
        state: liveRun.state,
        terminalFailure: liveRun.terminalFailure
    };

    return {
        ...runtimeWithoutTimeout,
        timeout: createHardTimeout(runtimeWithoutTimeout)
    };
}

function sendAssignmentForPlan(runtime: SupervisedRunRuntime, collectedPlan: CollectedRunPlan): void {
    runtime.child.send({
        assignedCases: collectedRunCaseIds(collectedPlan),
        kind: 'assign'
    });
}

async function continueLiveRun(
    liveRun: SupervisedLiveRun,
    collection: SupervisedCollectionResult,
    createResolvedRun: CreateResolvedRunFromCollection
): Promise<RunResult> {
    const resolvedRun = createResolvedRun(collection);
    const startedAtMs = liveRun.dependencies.wallClock.currentTimestampInMilliseconds;
    const runtime = createLiveRunRuntime(liveRun, resolvedRun);
    liveRun.runtime.write(runtime);
    runtime.state.recordRunnerErrors(resolvedRun.collectionRunnerErrors);
    await reportRunStart(runtime, collection.collectedPlan, startedAtMs);
    sendAssignmentForPlan(runtime, collection.collectedPlan);
    await liveRun.finishedSignal.promise;

    return await finishSupervisedRuntime(runtime, startedAtMs);
}

export async function collectSupervisedRun(
    command: SupervisedCollectCommand,
    dependencies: RunOrchestratorDependencies
): Promise<SupervisedCollectionResult> {
    const runtime = await createCollectionRuntime(command, dependencies);
    const childFinished = observeCollection(runtime);
    runtime.child.send(command);
    await childFinished;

    return readCollectedResult(runtime);
}

export async function runSupervisedCommand(
    command: SupervisedRunCommand,
    dependencies: RunOrchestratorDependencies,
    createResolvedRun: CreateResolvedRunFromCollection
): Promise<RunResult> {
    const liveRun = await createLiveRun(command, dependencies);
    observeLiveRun(command, liveRun);
    liveRun.child.send(command);
    const collection = await readLiveCollection(liveRun);

    return await continueLiveRun(liveRun, collection, createResolvedRun);
}

async function createRuntime(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): Promise<SupervisedRunRuntime> {
    const collectedPlan = supervisedCollectedPlan(resolvedRun);
    const runtimeWithoutTimeout = {
        child: await startSupervisedChild({
            capabilityRestrictions: resolvedRun.request.capabilityRestrictions,
            cwd: resolvedRun.cwd
        }, dependencies),
        collectedPlan: createStoredRunValue<CollectedRunPlan | null>(collectedPlan),
        completedResult: createStoredRunValue<RunResult | null>(null),
        dependencies,
        previousSample: createStoredRunValue<ResourceUsageSnapshot | null>(null),
        reporterContext: createReporterContext(resolvedRun),
        reporterEvents: createReporterEventQueue(),
        resolvedRun,
        state: createSupervisedRunState(),
        terminalFailure: createStoredRunValue(false)
    };

    return {
        ...runtimeWithoutTimeout,
        timeout: createHardTimeout(runtimeWithoutTimeout)
    };
}

export async function executeSupervisedRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): Promise<RunResult> {
    const runtime = await createRuntime(resolvedRun, dependencies);
    const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;
    const collectedPlan = supervisedCollectedPlan(resolvedRun);
    runtime.state.recordRunnerErrors(resolvedRun.collectionRunnerErrors);
    await reportRunStart(runtime, collectedPlan, startedAtMs);
    const childFinished = observeChild(runtime);
    sendRunCommand(runtime);
    sendAssignment(runtime);
    await childFinished;

    return await finishSupervisedRuntime(runtime, startedAtMs);
}
