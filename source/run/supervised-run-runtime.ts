import { createDefaultWorkId, workIdentityKey } from '../engine/identity.ts';
import type {
    ReporterEvent,
    ProcessUsageSnapshot,
    RunResult
} from './run-engine-primitives.ts';
import {
    resultWithRetainedArtifacts,
    reportResultWithDelivery,
    reportTerminalCases
} from './run-result-reporting.ts';
import {
    createRunResultFromCollectedPlan,
    emptyRunPlanStatus,
    collectedWorkloadInputs
} from './collected-run-plan.ts';
import type { RunRuntimeAttachments, CollectedRunPlan, ResolvedRun } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    replayUsesLocalProcessPolicy,
    createSupervisedHardTimeout,
    kill,
    type SupervisedChildHardTimeout,
    type SupervisedChildProcess
} from './supervised-child-process.ts';
import {
    captureCrashEvidence,
    findProcessBudgetBreach,
    captureProcessExhaustionEvidence,
    type ProcessBudgetBreach
} from './supervised-run-process-policy.ts';
import {
    collectedCasesByKey,
    deduplicatedChildRuntimePolicyErrors,
    deduplicatedRuntimePolicyErrors,
    type StoredRunValue,
    type SupervisedCase,
    type SupervisedRunState
} from './supervised-run-state.ts';
import type {
    SupervisedChildMessage,
    SupervisedCollectCommand,
    SupervisedRunCommand
} from './supervised-protocol.ts';

type NonTimingSupervisedChildMessage = Exclude<SupervisedChildMessage, { readonly kind: 'timing'; }>;

export type ReporterEventQueue = {
    readonly add: (eventReport: Promise<void>) => void;
    readonly wait: () => Promise<void>;
};

export type SupervisedHardTimeout = SupervisedChildHardTimeout;

export type SupervisedRunRuntimeSeed = {
    readonly attachments: RunRuntimeAttachments;
    readonly child: SupervisedChildProcess;
    readonly collectedPlan: StoredRunValue<CollectedRunPlan | null>;
    readonly completedResult: StoredRunValue<RunResult | null>;
    readonly dependencies: RunOrchestratorDependencies;
    readonly finalizeResult: (result: RunResult) => Promise<RunResult>;
    readonly previousSample: StoredRunValue<ProcessUsageSnapshot | null>;
    readonly reporterDelivery: Awaited<ReturnType<typeof createReporterDelivery>>;
    readonly reporterEvents: ReporterEventQueue;
    readonly resolvedRun: ResolvedRun;
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
};

export type SupervisedRunRuntime = SupervisedRunRuntimeSeed & {
    readonly timeout: SupervisedHardTimeout;
};

type PartialRunResultInput = {
    readonly collectedPlan: CollectedRunPlan;
    readonly dependencies: RunOrchestratorDependencies;
    readonly resolvedRun: ResolvedRun;
    readonly startedAtMicroseconds: number;
    readonly state: SupervisedRunState;
};

export type SupervisedCollectionRuntime<CollectionValue> = {
    readonly child: SupervisedChildProcess;
    readonly command: SupervisedCollectCommand | SupervisedRunCommand;
    readonly collected: StoredRunValue<CollectionValue>;
    readonly dependencies: RunOrchestratorDependencies;
    readonly previousSample: StoredRunValue<ProcessUsageSnapshot | null>;
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
};

export function createReporterEventQueue(): ReporterEventQueue {
    const eventReports: Promise<void>[] = [];

    return {
        add(eventReport) {
            eventReports.push(eventReport);
        },
        async wait() {
            await Promise.all(eventReports);
        }
    };
}

async function recordReporterEventErrors(
    event: ReporterEvent,
    state: SupervisedRunState,
    reporterDelivery: Awaited<ReturnType<typeof createReporterDelivery>>
): Promise<void> {
    const errors = await reporterDelivery.reportEvent(event);

    if (errors.length > 0) {
        state.recordRunnerErrors(errors);
    }
}

function applyTestStartEvent(
    event: Extract<ReporterEvent, { readonly kind: 'test-start'; }>,
    state: SupervisedRunState,
    cases: ReadonlyMap<string, SupervisedCase>,
    observedAtMicroseconds: number
): void {
    const workId = event.workId ?? createDefaultWorkId(event.case);
    const key = workIdentityKey(workId);
    const testCase = cases.get(key);

    if (testCase !== undefined) {
        state.addActiveCase(key, testCase, observedAtMicroseconds, { index: event.attempt });
    }
}

function applyTestEndEvent(
    event: Extract<ReporterEvent, { readonly kind: 'test-end'; }>,
    state: SupervisedRunState,
    observedAtMicroseconds: number
): void {
    const workId = event.workId ?? createDefaultWorkId(event.case);
    const key = workIdentityKey(workId);

    for (const artifact of event.artifacts) {
        if (
            [ 'debug', 'worker-crash', 'process-exhaustion' ].includes(artifact.payload.kind)
        ) {
            state.recordArtifact(artifact);
        }
    }
    state.recordTestAttemptResult(
        key,
        {
            property: event.property,
            benchmark: event.benchmark,
            attempts: [ {
                property: event.property,
                benchmark: event.benchmark,
                attempt: { index: event.attempt },
                durationMicroseconds: event.durationMicroseconds,
                outcome: event.outcome,
                verdict: event.verdict
            } ],
            retried: null,
            definitionLocations: event.definitionLocations,
            id: event.case,
            outcome: event.outcome,
            verdict: event.verdict,
            workId,
            durationMicroseconds: event.durationMicroseconds
        },
        event.completion,
        observedAtMicroseconds
    );
    state.removeActiveCase(key);
}

function applyProgressEvent(event: ReporterEvent, state: SupervisedRunState): void {
    if (event.kind === 'property-progress') {
        state.recordPropertyProgress(workIdentityKey(event.workId), event.attempt, event.property);
    } else if (event.kind === 'benchmark-progress') {
        state.recordBenchmarkProgress(workIdentityKey(event.workId), event.benchmark);
    } else if (event.kind === 'runner-error') {
        state.recordRunnerError(event.error);
    }
}

export function applyEvent(
    event: ReporterEvent,
    state: SupervisedRunState,
    cases: ReadonlyMap<string, SupervisedCase>,
    observedAtMicroseconds: number
): void {
    if (event.kind === 'debug-checkpoint') {
        state.recordArtifact(event.artifact);
    } else if (event.kind === 'test-start') {
        applyTestStartEvent(event, state, cases, observedAtMicroseconds);
    } else if (event.kind === 'test-end') {
        applyTestEndEvent(event, state, observedAtMicroseconds);
    } else {
        applyProgressEvent(event, state);
    }
}

function partialRunPlanStatus(input: PartialRunResultInput): RunResult['planStatus'] {
    const { resolvedRun, collectedPlan } = input;
    if (resolvedRun.facts.cases.length > 0) {
        return 'planned';
    }
    if (!resolvedRun.request.lastFailed && resolvedRun.request.shard.total === 1) {
        return 'planned';
    }
    return emptyRunPlanStatus(resolvedRun, collectedPlan);
}

function createPartialRunResult(input: PartialRunResultInput): RunResult {
    return createRunResultFromCollectedPlan(
        input.collectedPlan,
        input.state.perTestResults(),
        input.state.runnerErrors(),
        {
            completedAtMicroseconds: Number(input.dependencies.wallClock.currentMonotonicMicroseconds),
            planStatus: partialRunPlanStatus(input),
            processUsage: null,
            startedAtMicroseconds: input.startedAtMicroseconds,
            testExecutionWallTimeMicroseconds: input.state.testExecutionWallTimeMicroseconds()
        }
    );
}

export async function createReporterDelivery(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): ReturnType<RunOrchestratorDependencies['reporterDispatcher']['createDelivery']> {
    return await dependencies.reporterDispatcher.createDelivery(
        resolvedRun.reporters,
        resolvedRun.config.outputRenderer
    );
}

export function supervisedCollectedPlan(resolvedRun: ResolvedRun): CollectedRunPlan {
    if (resolvedRun.plan.kind !== 'supervised') {
        throw new Error('Supervised execution requires a supervised collected plan.');
    }

    return resolvedRun.plan.collectedPlan;
}

export function supervisedWorkloadInputs(resolvedRun: ResolvedRun): ReturnType<typeof collectedWorkloadInputs> {
    return collectedWorkloadInputs(supervisedCollectedPlan(resolvedRun));
}

export const createHardTimeout: (runtime: SupervisedRunRuntimeSeed) => SupervisedHardTimeout =
    createSupervisedHardTimeout;

function childEventWithAttachments(event: ReporterEvent, runtime: SupervisedRunRuntime): ReporterEvent {
    if (event.kind !== 'test-end') {
        return event;
    }
    const work = event.workId ?? createDefaultWorkId(event.case);
    runtime.attachments?.settleAttempt(
        work,
        { index: event.attempt },
        event.verdict,
        null
    );
    return {
        ...event,
        artifacts: [
            ...event.artifacts,
            ...runtime.attachments?.caseArtifacts(work, {
                index: event.attempt
            }, null) ?? [],
            ...runtime
                .state
                .caseArtifacts(work, {
                    index: event.attempt
                })
                .filter(function retainedEvidence(artifact) {
                    return artifact.payload.kind !== 'debug' || event.artifacts.every(function completedDebug(value) {
                        return value.payload.kind !== 'debug';
                    });
                })
        ]
    };
}

function handleChildEvent(event: ReporterEvent, runtime: SupervisedRunRuntime): void {
    const collectedPlan = runtime.collectedPlan.read();
    const reportedEvent = childEventWithAttachments(event, runtime);

    if (collectedPlan !== null) {
        applyEvent(
            reportedEvent,
            runtime.state,
            collectedCasesByKey(collectedPlan),
            Number(runtime.dependencies.wallClock.currentMonotonicMicroseconds)
        );
    }

    if (reportedEvent.kind === 'test-start' || reportedEvent.kind === 'test-end') {
        runtime.timeout.start();
    }

    runtime.reporterEvents.add(recordReporterEventErrors(
        reportedEvent,
        runtime.state,
        runtime.reporterDelivery
    ));
}

function handleProcessBudgetBreach(
    breach: ProcessBudgetBreach,
    runtime: SupervisedRunRuntime,
    previousSample: ProcessUsageSnapshot | null
): void {
    runtime.terminalFailure.write(true);
    const error = captureProcessExhaustionEvidence(breach, runtime.state, previousSample);
    runtime.state.recordRunnerError(error);
    runtime.reporterEvents.add(recordReporterEventErrors(
        { error, kind: 'runner-error' },
        runtime.state,
        runtime.reporterDelivery
    ));
    runtime.state.recordTerminalActiveCases(
        'process-exhausted',
        Number(runtime.dependencies.wallClock.currentMonotonicMicroseconds)
    );
    runtime.timeout.clear();
    kill(runtime.child);
}

function handleChildSample(sample: ProcessUsageSnapshot, runtime: SupervisedRunRuntime): void {
    if (runtime.terminalFailure.read()) {
        return;
    }

    if (replayUsesLocalProcessPolicy(runtime.resolvedRun)) {
        return;
    }
    const previousSample = runtime.previousSample.read();
    const breach = findProcessBudgetBreach(
        runtime.resolvedRun.facts.execution.processUsagePolicy.budgets,
        sample,
        previousSample
    );
    runtime.previousSample.write(sample);

    if (breach !== null) {
        handleProcessBudgetBreach(breach, runtime, previousSample);
    }
}

function handleCompletedResult(result: RunResult, runtime: SupervisedRunRuntime): void {
    for (const artifact of result.artifacts) {
        if (
            [ 'debug', 'worker-crash', 'process-exhaustion' ].includes(artifact.payload.kind)
        ) {
            runtime.state.recordArtifact(artifact);
        }
    }
    for (const testResult of result.perTest) {
        runtime.state.removeActiveCase(workIdentityKey(testResult.workId));
    }
    runtime.state.beginOutputDraining();
    const supervisorErrors = deduplicatedRuntimePolicyErrors(runtime.state.runnerErrors());

    runtime.completedResult.write({
        ...result,
        runnerErrors: [
            ...supervisorErrors,
            ...deduplicatedChildRuntimePolicyErrors(result.runnerErrors, supervisorErrors)
        ]
    });
}

export function handleChildMessage(
    message: NonTimingSupervisedChildMessage,
    runtime: SupervisedRunRuntime
): void {
    if (message.kind === 'execution-data' || message.kind === 'execution-checkpoint') {
        return;
    }
    if (message.kind === 'collected') {
        runtime.collectedPlan.write(message.collectedPlan);
        runtime.state.recordRunnerErrors(message.runnerErrors);
    } else if (message.kind === 'event') {
        handleChildEvent(message.event, runtime);
    } else if (message.kind === 'sample') {
        handleChildSample(message.sample, runtime);
    } else {
        handleCompletedResult(message.result, runtime);
    }
}

export function handleCollectionSample<CollectionValue>(
    sample: ProcessUsageSnapshot,
    runtime: SupervisedCollectionRuntime<CollectionValue>
): void {
    if (runtime.terminalFailure.read()) {
        return;
    }

    const previousSample = runtime.previousSample.read();
    const breach = findProcessBudgetBreach(runtime.command.processBudgets, sample, previousSample);
    runtime.previousSample.write(sample);

    if (breach !== null) {
        runtime.terminalFailure.write(true);
        runtime.state.recordRunnerError(captureProcessExhaustionEvidence(breach, runtime.state, previousSample));
        kill(runtime.child);
    }
}

export async function reportRunStart(
    runtime: SupervisedRunRuntime,
    collectedPlan: CollectedRunPlan,
    startedAtMs: number
): Promise<void> {
    const startedAt = new Date(startedAtMs);

    await recordReporterEventErrors(
        {
            facts: runtime.resolvedRun.facts,
            kind: 'run-start',
            root: {
                annotations: collectedPlan.root.annotations,
                title: collectedPlan.root.title
            },
            startedAt: startedAt.toISOString()
        },
        runtime.state,
        runtime.reporterDelivery
    );
}

function resultWithSupervisedArtifacts(result: RunResult, runtime: SupervisedRunRuntime): RunResult {
    return resultWithRetainedArtifacts(
        result,
        runtime.state.artifacts(),
        runtime.resolvedRun.facts.execution.retries?.artifacts ?? 'first-failure-and-final'
    );
}

function parentTimedResult(runtime: SupervisedRunRuntime, startedAtMicroseconds: number): RunResult {
    const collectedPlan = runtime.collectedPlan.read() ?? supervisedCollectedPlan(runtime.resolvedRun);

    return resultWithSupervisedArtifacts(
        createPartialRunResult({
            collectedPlan,
            dependencies: runtime.dependencies,
            resolvedRun: runtime.resolvedRun,
            startedAtMicroseconds,
            state: runtime.state
        }),
        runtime
    );
}

function selectRunResult(runtime: SupervisedRunRuntime, startedAtMicroseconds: number): RunResult {
    const completedResult = runtime.completedResult.read();
    const parentResult = parentTimedResult(runtime, startedAtMicroseconds);

    if (completedResult === null) {
        return parentResult;
    }

    const supervisorErrors = runtime.state.runnerErrors();
    const runnerErrors = deduplicatedRuntimePolicyErrors([
        ...supervisorErrors,
        ...deduplicatedChildRuntimePolicyErrors(completedResult.runnerErrors, supervisorErrors)
    ]);

    return {
        ...parentResult,
        processUsage: completedResult.processUsage,
        runnerErrors,
        status: runnerErrors.length === 0 ? parentResult.status : 'failed'
    };
}

async function reportFinalResult(result: RunResult, runtime: SupervisedRunRuntime): Promise<RunResult> {
    return await reportResultWithDelivery(result, runtime.reporterDelivery);
}

function retainChildExitEvidence(runtime: SupervisedRunRuntime): void {
    if (
        runtime.state.artifacts().every(function capturedCrash(artifact) {
            return !(artifact.payload.kind === 'worker-crash' && artifact.source === 'boundary-captured');
        })
    ) {
        return;
    }
    runtime.state.recordBoundaryFailure({
        kind: 'worker-crash',
        reason: 'process-exit',
        exitCode: runtime.child.exitCode,
        signal: runtime.child.signalCode,
        coreDumpPath: null,
        nativeAddons: null
    });
}

function recordUnexpectedChildExit(runtime: SupervisedRunRuntime): void {
    if (runtime.child.exitCode === null && runtime.child.signalCode === null) {
        return;
    }
    if (runtime.completedResult.read() === null && !runtime.terminalFailure.read()) {
        runtime.terminalFailure.write(true);
        runtime.state.recordRunnerError(
            captureCrashEvidence(runtime.state, 'Supervised child exited before returning a result.')
        );
        runtime.state.recordTerminalActiveCases(
            'crashed',
            Number(runtime.dependencies.wallClock.currentMonotonicMicroseconds)
        );
    }
}
export async function finishSupervisedRuntime(
    runtime: SupervisedRunRuntime,
    startedAtMicroseconds: number
): Promise<RunResult> {
    runtime.timeout.clear();
    recordUnexpectedChildExit(runtime);
    retainChildExitEvidence(runtime);
    await runtime.reporterEvents.wait();

    const result = await runtime.finalizeResult(selectRunResult(runtime, startedAtMicroseconds));

    const reportedResult = await reportTerminalCases(
        result,
        runtime.state.terminalCases(),
        runtime.collectedPlan.read() ?? supervisedCollectedPlan(runtime.resolvedRun),
        runtime.reporterDelivery
    );
    return await reportFinalResult(reportedResult, runtime);
}
