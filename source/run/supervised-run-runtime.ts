import { createDefaultWorkId, workIdentityKey } from '../engine/identity.ts';
import type {
    ReporterEvent,
    ResourceUsageSnapshot,
    RunResult
} from './run-engine-primitives.ts';
import { resultWithRetainedArtifacts, reportResultWithDelivery } from './run-result-reporting.ts';
import { createRunResultFromCollectedPlan } from './collected-run-plan.ts';
import type { CollectedRunPlan, ResolvedRun } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    createSupervisedHardTimeout,
    kill,
    type SupervisedChildHardTimeout,
    type SupervisedChildProcess
} from './supervised-child-process.ts';
import {
    findResourceBudgetBreach,
    resourceExhaustionError,
    type ResourceBudgetBreach
} from './supervised-run-resource-policy.ts';
import {
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
    readonly child: SupervisedChildProcess;
    readonly collectedPlan: StoredRunValue<CollectedRunPlan | null>;
    readonly completedResult: StoredRunValue<RunResult | null>;
    readonly dependencies: RunOrchestratorDependencies;
    readonly finalizeResult: (result: RunResult) => Promise<RunResult>;
    readonly previousSample: StoredRunValue<ResourceUsageSnapshot | null>;
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
    readonly previousSample: StoredRunValue<ResourceUsageSnapshot | null>;
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

function caseByKey(collectedPlan: CollectedRunPlan): ReadonlyMap<string, SupervisedCase> {
    const entries: [string, SupervisedCase][] = [];

    for (const file of collectedPlan.files) {
        for (const testCase of file.cases) {
            const id = {
                file: file.file,
                params: testCase.params,
                suite: testCase.suitePath.map(function toTitle(suite) {
                    return suite.title;
                }),
                title: testCase.title
            };

            const workId = testCase.workId ?? createDefaultWorkId(id);

            entries.push([ workIdentityKey(workId), {
                capture: testCase.controls.capture,
                id,
                workId
            } ]);
        }
    }

    return new Map(entries);
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

    state.recordTestAttemptResult(
        key,
        {
            attempts: [ {
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

export function applyEvent(
    event: ReporterEvent,
    state: SupervisedRunState,
    cases: ReadonlyMap<string, SupervisedCase>,
    observedAtMicroseconds: number
): void {
    if (event.kind === 'test-start') {
        applyTestStartEvent(event, state, cases, observedAtMicroseconds);
    } else if (event.kind === 'test-end') {
        applyTestEndEvent(event, state, observedAtMicroseconds);
    } else if (event.kind === 'runner-error') {
        state.recordRunnerError(event.error);
    }
}

function createPartialRunResult(input: PartialRunResultInput): RunResult {
    return createRunResultFromCollectedPlan(
        input.collectedPlan,
        input.state.perTestResults(),
        input.state.runnerErrors(),
        {
            completedAtMicroseconds: Number(input.dependencies.wallClock.currentMonotonicMicroseconds),
            planStatus: input.resolvedRun.facts.cases.length === 0 && input.resolvedRun.request.shard.total > 1
                ? 'empty-shard'
                : 'planned',
            resourceUsage: null,
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

export const createHardTimeout: (runtime: SupervisedRunRuntimeSeed) => SupervisedHardTimeout =
    createSupervisedHardTimeout;

function handleChildEvent(event: ReporterEvent, runtime: SupervisedRunRuntime): void {
    const collectedPlan = runtime.collectedPlan.read();
    const reportedEvent: ReporterEvent = event.kind === 'test-end'
        ? {
            ...event,
            artifacts: [
                ...event.artifacts,
                ...runtime.state.caseArtifacts(event.workId ?? createDefaultWorkId(event.case), {
                    index: event.attempt
                })
            ]
        }
        : event;

    if (collectedPlan !== null) {
        applyEvent(
            reportedEvent,
            runtime.state,
            caseByKey(collectedPlan),
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

function handleResourceBudgetBreach(
    breach: ResourceBudgetBreach,
    runtime: SupervisedRunRuntime
): void {
    runtime.terminalFailure.write(true);
    const error = resourceExhaustionError(breach, runtime.state);
    runtime.state.recordRunnerError(error);
    runtime.reporterEvents.add(recordReporterEventErrors(
        { error, kind: 'runner-error' },
        runtime.state,
        runtime.reporterDelivery
    ));
    runtime.state.recordTerminalActiveCases(
        'resource-exhausted',
        Number(runtime.dependencies.wallClock.currentMonotonicMicroseconds)
    );
    runtime.timeout.clear();
    kill(runtime.child);
}

function handleChildSample(sample: ResourceUsageSnapshot, runtime: SupervisedRunRuntime): void {
    if (runtime.terminalFailure.read()) {
        return;
    }

    const breach = findResourceBudgetBreach(
        runtime.resolvedRun.facts.execution.resourceUsagePolicy.budgets,
        sample,
        runtime.previousSample.read()
    );
    runtime.previousSample.write(sample);

    if (breach !== null) {
        handleResourceBudgetBreach(breach, runtime);
    }
}

function handleCompletedResult(result: RunResult, runtime: SupervisedRunRuntime): void {
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
    sample: ResourceUsageSnapshot,
    runtime: SupervisedCollectionRuntime<CollectionValue>
): void {
    if (runtime.terminalFailure.read()) {
        return;
    }

    const breach = findResourceBudgetBreach(
        runtime.command.resourceBudgets,
        sample,
        runtime.previousSample.read()
    );
    runtime.previousSample.write(sample);

    if (breach !== null) {
        runtime.terminalFailure.write(true);
        runtime.state.recordRunnerError(resourceExhaustionError(breach, runtime.state));
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
        resourceUsage: completedResult.resourceUsage,
        runnerErrors,
        status: runnerErrors.length === 0 ? parentResult.status : 'failed'
    };
}

async function reportFinalResult(result: RunResult, runtime: SupervisedRunRuntime): Promise<RunResult> {
    return await reportResultWithDelivery(result, runtime.reporterDelivery);
}

export async function finishSupervisedRuntime(
    runtime: SupervisedRunRuntime,
    startedAtMicroseconds: number
): Promise<RunResult> {
    runtime.timeout.clear();
    await runtime.reporterEvents.wait();

    const result = await runtime.finalizeResult(selectRunResult(runtime, startedAtMicroseconds));

    return await reportFinalResult(result, runtime);
}
