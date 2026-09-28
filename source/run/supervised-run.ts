import type {
    ResourceUsageSnapshot,
    RunResult
} from '../packages/engine/engine.entry-point.ts';
import {
    childProcessEnvelope,
    envelopeMessage
} from './child-process-protocol.ts';
import type {
    CollectedRunPlan,
    ResolvedRun
} from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    supervisedChildCorrelationId,
    type SupervisedChildMessage,
    type SupervisedRunCommand
} from './supervised-protocol.ts';
import {
    observeSupervisedChildOutput,
    type SupervisedChildProcess
} from './supervised-child-process.ts';
import { RunCollectionError } from './run-errors.ts';
import {
    applyEvent,
    createHardTimeout,
    effectiveSupervisedCapabilityRestrictions,
    createReporterDelivery,
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
import {
    emptyTimingSpanMetadata,
    instantTimingSpanObservation,
    type RunTimingMeasurement
} from './run-timing-collection.ts';

type RunResultFinalizer = (resolvedRun: ResolvedRun, result: RunResult) => Promise<RunResult>;

type SupervisedCollectionResult = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunResult['runnerErrors'][number][];
};

type CreateResolvedRunFromCollection = (
    collection: SupervisedCollectionResult
) => Promise<ResolvedRun>;

type SupervisedExecutionOptions = {
    readonly finalizeResult: RunResultFinalizer;
    readonly timing: RunTimingMeasurement | null;
};

type SupervisedRunStartTimes = {
    readonly epochMilliseconds: number;
    readonly monotonicMicroseconds: number;
};

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
    readonly finalizeResult: RunResultFinalizer;
    readonly previousSample: StoredRunValue<ResourceUsageSnapshot | null>;
    readonly runtime: StoredRunValue<SupervisedRunRuntime | null>;
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
    readonly timing: RunTimingMeasurement | null;
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

const keepRunResult: RunResultFinalizer = async function keepRunResult(_resolvedRun, result) {
    return result;
};

function supervisedRunStartTimes(dependencies: RunOrchestratorDependencies): SupervisedRunStartTimes {
    return {
        epochMilliseconds: dependencies.wallClock.currentEpochMilliseconds,
        monotonicMicroseconds: dependencies.wallClock.currentMonotonicMicroseconds
    };
}

function supervisedChildMessage(message: unknown): SupervisedChildMessage | null {
    return envelopeMessage<SupervisedChildMessage>(message, supervisedChildCorrelationId);
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
        attributedToWork: null,
        cause: { reason: 'Supervised collection exceeded collection timeout.' },
        diagnostics: [ { label: 'reason', value: 'Supervised collection exceeded collection timeout.' } ],
        message: 'Supervised collection exceeded collection timeout.',
        subtype: 'crash'
    });
    kill(child);
    collectedSignal.resolve();
}

async function createLiveRun(
    command: SupervisedRunCommand,
    dependencies: RunOrchestratorDependencies,
    options: SupervisedExecutionOptions
): Promise<SupervisedLiveRun> {
    const child = await (options.timing?.measureAsync(
        'supervised-process.spawn',
        emptyTimingSpanMetadata(),
        async function startTimedLiveSupervisedChild() {
            return await dependencies.startSupervisedChild({
                capabilityRestrictions: command.capabilityRestrictions,
                cwd: command.cwd,
                environmentVariables: dependencies.runtimeCapabilityPolicy.readEnvironment(),
                testFamily: command.testFamily
            });
        }
    ) ?? dependencies.startSupervisedChild({
        capabilityRestrictions: command.capabilityRestrictions,
        cwd: command.cwd,
        environmentVariables: dependencies.runtimeCapabilityPolicy.readEnvironment(),
        testFamily: command.testFamily
    }));
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
        finalizeResult: options.finalizeResult,
        previousSample: createStoredRunValue<ResourceUsageSnapshot | null>(null),
        runtime: createStoredRunValue<SupervisedRunRuntime | null>(null),
        state,
        terminalFailure,
        timing: options.timing
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
        liveRun.timing?.record(instantTimingSpanObservation({
            kind: 'supervised-process.ready',
            metadata: emptyTimingSpanMetadata(),
            observedAtMicroseconds: liveRun.dependencies.wallClock.currentMonotonicMicroseconds,
            status: 'success'
        }));
        liveRun.collected.write({
            collectedPlan: message.collectedPlan,
            runnerErrors: message.runnerErrors
        });
        liveRun.collectedSignal.resolve();
    } else if (message.kind === 'sample') {
        handleCollectionSample(message.sample, collectionRuntime(command, liveRun));
    } else if (message.kind === 'event') {
        applyEvent(
            message.event,
            liveRun.state,
            new Map(),
            liveRun.dependencies.wallClock.currentMonotonicMicroseconds
        );
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
    observeSupervisedChildOutput({
        capabilityRestrictions: command.capabilityRestrictions,
        capture: command.capture,
        child: liveRun.child,
        dependencies: liveRun.dependencies,
        state: liveRun.state,
        terminalFailure: liveRun.terminalFailure
    });
    liveRun.child.on('message', function receiveMessage(message: unknown) {
        const childMessage = supervisedChildMessage(message);

        if (childMessage !== null) {
            handleLiveMessage(childMessage, command, liveRun);
        }
    });
    liveRun.child.on('error', function recordChildError(error: Error) {
        liveRun.terminalFailure.write(true);
        liveRun.state.recordRunnerError({
            attributedTo: null,
            attributedToWork: null,
            cause: error,
            diagnostics: [],
            message: error.message,
            subtype: 'crash'
        });
        liveRun.collectedSignal.resolve();
    });
    liveRun.child.on('exit', function resolveExit() {
        const exitedAtMicroseconds = liveRun.dependencies.wallClock.currentMonotonicMicroseconds;

        liveRun.timing?.record(instantTimingSpanObservation({
            kind: 'supervised-process.exit',
            metadata: emptyTimingSpanMetadata(),
            observedAtMicroseconds: exitedAtMicroseconds,
            status: liveRun.terminalFailure.read() ? 'failure' : 'success'
        }));
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

async function createLiveRunRuntime(
    liveRun: SupervisedLiveRun,
    resolvedRun: ResolvedRun
): Promise<SupervisedRunRuntime> {
    const runtimeWithoutTimeout = {
        child: liveRun.child,
        collectedPlan: createStoredRunValue<CollectedRunPlan | null>(supervisedCollectedPlan(resolvedRun)),
        completedResult: createStoredRunValue<RunResult | null>(null),
        dependencies: liveRun.dependencies,
        async finalizeResult(result: RunResult): Promise<RunResult> {
            return await liveRun.finalizeResult(resolvedRun, result);
        },
        previousSample: liveRun.previousSample,
        reporterDelivery: await createReporterDelivery(resolvedRun, liveRun.dependencies),
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

function sendAssignmentForPlan(runtime: SupervisedRunRuntime): void {
    runtime.child.send(childProcessEnvelope(supervisedChildCorrelationId, {
        assignedWork: runtime.resolvedRun.facts.cases.map(function toWorkId(testCase) {
            return testCase.workId;
        }),
        kind: 'assign'
    }));
}

async function reportRunStartForPlannedCases(
    runtime: SupervisedRunRuntime,
    collectedPlan: CollectedRunPlan,
    startedAtMs: number
): Promise<void> {
    if (runtime.resolvedRun.facts.cases.length === 0) {
        return;
    }

    await reportRunStart(runtime, collectedPlan, startedAtMs);
}

async function continueLiveRun(
    liveRun: SupervisedLiveRun,
    collection: SupervisedCollectionResult,
    createResolvedRun: CreateResolvedRunFromCollection
): Promise<RunResult> {
    const resolvedRun = await createResolvedRun(collection);
    const startedAt = supervisedRunStartTimes(liveRun.dependencies);
    const runtime = await createLiveRunRuntime(liveRun, resolvedRun);
    const collectedPlan = supervisedCollectedPlan(resolvedRun);
    liveRun.runtime.write(runtime);
    runtime.state.recordRunnerErrors(resolvedRun.collectionRunnerErrors);
    await reportRunStartForPlannedCases(runtime, collectedPlan, startedAt.epochMilliseconds);
    sendAssignmentForPlan(runtime);
    await liveRun.finishedSignal.promise;

    return await finishSupervisedRuntime(runtime, startedAt.monotonicMicroseconds);
}

export async function runSupervisedCommand(
    command: SupervisedRunCommand,
    dependencies: RunOrchestratorDependencies,
    createResolvedRun: CreateResolvedRunFromCollection,
    options: SupervisedExecutionOptions
): Promise<RunResult> {
    const liveRun = await createLiveRun(command, dependencies, options);
    observeLiveRun(command, liveRun);
    liveRun.child.send(childProcessEnvelope(supervisedChildCorrelationId, command));
    const collection = await readLiveCollection(liveRun);

    return await continueLiveRun(liveRun, collection, createResolvedRun);
}

async function createRuntime(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    options: SupervisedExecutionOptions
): Promise<SupervisedRunRuntime> {
    const collectedPlan = supervisedCollectedPlan(resolvedRun);
    const runtimeWithoutTimeout = {
        child: await (options.timing?.measureAsync(
            'supervised-process.spawn',
            emptyTimingSpanMetadata(),
            async function startTimedSupervisedChild() {
                return await dependencies.startSupervisedChild({
                    capabilityRestrictions: effectiveSupervisedCapabilityRestrictions(resolvedRun),
                    cwd: resolvedRun.cwd,
                    environmentVariables: dependencies.runtimeCapabilityPolicy.readEnvironment(),
                    testFamily: resolvedRun.facts.execution.testFamily
                });
            }
        ) ?? dependencies.startSupervisedChild({
            capabilityRestrictions: effectiveSupervisedCapabilityRestrictions(resolvedRun),
            cwd: resolvedRun.cwd,
            environmentVariables: dependencies.runtimeCapabilityPolicy.readEnvironment(),
            testFamily: resolvedRun.facts.execution.testFamily
        })),
        collectedPlan: createStoredRunValue<CollectedRunPlan | null>(collectedPlan),
        completedResult: createStoredRunValue<RunResult | null>(null),
        dependencies,
        async finalizeResult(result: RunResult): Promise<RunResult> {
            return await options.finalizeResult(resolvedRun, result);
        },
        previousSample: createStoredRunValue<ResourceUsageSnapshot | null>(null),
        reporterDelivery: await createReporterDelivery(resolvedRun, dependencies),
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

function recordSupervisedReady(
    timing: RunTimingMeasurement | null,
    dependencies: RunOrchestratorDependencies,
    startedAtMicroseconds: number
): void {
    timing?.record({
        completedAtMicroseconds: dependencies.wallClock.currentMonotonicMicroseconds,
        kind: 'supervised-process.ready',
        metadata: emptyTimingSpanMetadata(),
        startedAtMicroseconds,
        status: 'success'
    });
}

function recordSupervisedExit(
    timing: RunTimingMeasurement | null,
    dependencies: RunOrchestratorDependencies,
    runtime: SupervisedRunRuntime
): void {
    timing?.record(instantTimingSpanObservation({
        kind: 'supervised-process.exit',
        metadata: emptyTimingSpanMetadata(),
        observedAtMicroseconds: dependencies.wallClock.currentMonotonicMicroseconds,
        status: runtime.terminalFailure.read() ? 'failure' : 'success'
    }));
}

async function runSupervisedChild(
    runtime: SupervisedRunRuntime,
    dependencies: RunOrchestratorDependencies,
    timing: RunTimingMeasurement | null
): Promise<void> {
    const childFinished = observeChild(runtime);
    const readyStartedAtMicroseconds = dependencies.wallClock.currentMonotonicMicroseconds;
    sendRunCommand(runtime);
    sendAssignment(runtime);
    recordSupervisedReady(timing, dependencies, readyStartedAtMicroseconds);
    await childFinished;
    recordSupervisedExit(timing, dependencies, runtime);
}

async function finishTimedSupervisedRun(
    runtime: SupervisedRunRuntime,
    startedAtMicroseconds: number,
    timing: RunTimingMeasurement | null
): Promise<RunResult> {
    return await (timing?.measureAsync(
        'supervised-process.teardown',
        emptyTimingSpanMetadata(),
        async function finishTimedSupervisedRuntime() {
            return await finishSupervisedRuntime(runtime, startedAtMicroseconds);
        }
    ) ?? finishSupervisedRuntime(runtime, startedAtMicroseconds));
}

export async function executeSupervisedRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies,
    options: SupervisedExecutionOptions = { finalizeResult: keepRunResult, timing: null }
): Promise<RunResult> {
    const runtime = await createRuntime(resolvedRun, dependencies, options);
    const startedAt = supervisedRunStartTimes(dependencies);
    const collectedPlan = supervisedCollectedPlan(resolvedRun);
    runtime.state.recordRunnerErrors(resolvedRun.collectionRunnerErrors);
    await reportRunStart(runtime, collectedPlan, startedAt.epochMilliseconds);
    await runSupervisedChild(runtime, dependencies, options.timing);

    return await finishTimedSupervisedRun(runtime, startedAt.monotonicMicroseconds, options.timing);
}
