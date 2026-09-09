import { caseIdentityKey } from '../engine/identity.ts';
import type {
    ReporterEvent,
    ResourceUsageSnapshot,
    RunResult
} from '../packages/engine/engine.entry-point.ts';
import type { ReporterDelivery } from '../engine/reporter-dispatcher.ts';
import { createRunResultFromCollectedPlan } from './collected-run-plan.ts';
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
    type SupervisedChildProcess
} from './supervised-child-process.ts';
import {
    crashError,
    findResourceBudgetBreach,
    resourceExhaustionError,
    type ResourceBudgetBreach
} from './supervised-run-resource-policy.ts';
import {
    deduplicatedChildRuntimePolicyErrors,
    type StoredRunValue,
    type SupervisedCase,
    type SupervisedRunState
} from './supervised-run-state.ts';

type ReporterEventQueue = {
    readonly add: (eventReport: Promise<void>) => void;
    readonly wait: () => Promise<void>;
};

export type SupervisedHardTimeout = {
    readonly clear: () => void;
    readonly start: () => void;
};

export type SupervisedRunRuntimeSeed = {
    readonly child: SupervisedChildProcess;
    readonly collectedPlan: StoredRunValue<CollectedRunPlan | null>;
    readonly completedResult: StoredRunValue<RunResult | null>;
    readonly dependencies: RunOrchestratorDependencies;
    readonly previousSample: StoredRunValue<ResourceUsageSnapshot | null>;
    readonly reporterDelivery: ReporterDelivery;
    readonly reporterEvents: ReporterEventQueue;
    readonly resolvedRun: ResolvedRun;
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
};

export type SupervisedRunRuntime = SupervisedRunRuntimeSeed & {
    readonly timeout: SupervisedHardTimeout;
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

function runStartTimeFromMilliseconds(milliseconds: number): string {
    const startedAt = new Date(milliseconds);

    return startedAt.toISOString();
}

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
    reporterDelivery: ReporterDelivery
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

            entries.push([ caseIdentityKey(id), { capture: testCase.metadata.capture, id } ]);
        }
    }

    return new Map(entries);
}

export function applyEvent(
    event: ReporterEvent,
    state: SupervisedRunState,
    cases: ReadonlyMap<string, SupervisedCase>
): void {
    if (event.kind === 'test-start') {
        const testCase = cases.get(caseIdentityKey(event.case));

        if (testCase !== undefined) {
            state.addActiveCase(caseIdentityKey(event.case), testCase);
        }
    } else if (event.kind === 'test-end') {
        const key = caseIdentityKey(event.case);
        state.removeActiveCase(key);
        state.recordPerTestResult(key, {
            id: event.case,
            outcome: event.outcome,
            verdict: event.verdict
        });
    } else if (event.kind === 'runner-error') {
        state.recordRunnerError(event.error);
    }
}

function createPartialRunResult(
    collectedPlan: CollectedRunPlan,
    state: SupervisedRunState,
    dependencies: RunOrchestratorDependencies,
    startedAtMs: number
): RunResult {
    return createRunResultFromCollectedPlan(
        collectedPlan,
        state.perTestResults(),
        state.runnerErrors(),
        {
            resourceUsage: null,
            startedAtMs,
            wallClock: dependencies.wallClock
        }
    );
}

export function kill(child: SupervisedChildProcess): void {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
    }
}

export async function createReporterDelivery(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): Promise<ReporterDelivery> {
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

export function createHardTimeout(runtime: SupervisedRunRuntimeSeed): SupervisedHardTimeout {
    let hardTimeout: ReturnType<RunOrchestratorDependencies['wallClock']['setTimeout']> | null = null;

    return {
        clear() {
            if (hardTimeout !== null) {
                runtime.dependencies.wallClock.clearTimeout(hardTimeout);
                hardTimeout = null;
            }
        },
        start() {
            if (hardTimeout !== null || runtime.state.activeCases.size === 0) {
                return;
            }

            hardTimeout = runtime.dependencies.wallClock.setTimeout(function killHardTimedOutChild() {
                runtime.terminalFailure.write(true);
                runtime.state.recordRunnerError(crashError(runtime.state, 'Supervised child exceeded hard timeout.'));
                runtime.state.recordTerminalActiveCases('crashed');
                kill(runtime.child);
            }, runtime.resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds);
        }
    };
}

function supervisedEngine(resolvedRun: ResolvedRun): SupervisedRunCommand['engine'] {
    if (resolvedRun.engine.kind === 'instance') {
        throw new Error('Instance engines cannot run in supervised children.');
    }

    return resolvedRun.engine;
}

export function effectiveSupervisedCapabilityRestrictions(
    resolvedRun: ResolvedRun
): SupervisedRunCommand['capabilityRestrictions'] {
    if (resolvedRun.facts.execution.testFamily === 'integration') {
        return { mode: 'disabled' };
    }

    return resolvedRun.request.capabilityRestrictions;
}

function createRunCommand(resolvedRun: ResolvedRun): SupervisedRunCommand {
    return {
        capabilityRestrictions: effectiveSupervisedCapabilityRestrictions(resolvedRun),
        capture: resolvedRun.facts.execution.capture,
        collectionTimeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.collectionMilliseconds,
        cwd: resolvedRun.cwd,
        engine: supervisedEngine(resolvedRun),
        hardTimeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds,
        kind: 'run',
        paths: resolvedRun.request.paths,
        resourceBudgets: resolvedRun.facts.execution.resourceUsagePolicy.budgets,
        resourceUsageSamplingIntervalMilliseconds: resolvedRun
            .facts
            .execution
            .resourceUsagePolicy
            .samplingIntervalMilliseconds,
        scheduling: resolvedRun.facts.execution.scheduling,
        testFamily: resolvedRun.facts.execution.testFamily,
        timeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.softMilliseconds
    };
}

export function sendRunCommand(runtime: SupervisedRunRuntime): void {
    runtime.child.send(createRunCommand(runtime.resolvedRun));
}

export function sendAssignment(runtime: SupervisedRunRuntime): void {
    runtime.child.send({
        assignedCases: runtime.resolvedRun.facts.cases.map(function toCaseId(testCase) {
            return testCase.id;
        }),
        kind: 'assign'
    });
}

function handleChildEvent(event: ReporterEvent, runtime: SupervisedRunRuntime): void {
    const collectedPlan = runtime.collectedPlan.read();
    const reportedEvent: ReporterEvent = event.kind === 'test-end'
        ? {
            ...event,
            artifacts: [
                ...event.artifacts,
                ...runtime.state.caseArtifacts(event.case)
            ]
        }
        : event;

    if (collectedPlan !== null) {
        applyEvent(reportedEvent, runtime.state, caseByKey(collectedPlan));
    }

    if (reportedEvent.kind === 'test-start') {
        runtime.timeout.start();
    } else if (reportedEvent.kind === 'test-end' && runtime.state.activeCases.size === 0) {
        runtime.timeout.clear();
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
    runtime.state.recordTerminalActiveCases('resource-exhausted');
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
    const supervisorErrors = runtime.state.runnerErrors();

    runtime.completedResult.write({
        ...result,
        runnerErrors: [
            ...supervisorErrors,
            ...deduplicatedChildRuntimePolicyErrors(result.runnerErrors, supervisorErrors)
        ]
    });
}

export function handleChildMessage(message: SupervisedChildMessage, runtime: SupervisedRunRuntime): void {
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

export async function observeChild(runtime: SupervisedRunRuntime): Promise<void> {
    observeSupervisedChildOutput({
        capabilityRestrictions: effectiveSupervisedCapabilityRestrictions(runtime.resolvedRun),
        capture: runtime.resolvedRun.facts.execution.capture,
        child: runtime.child,
        dependencies: runtime.dependencies,
        state: runtime.state,
        terminalFailure: runtime.terminalFailure
    });

    return new Promise(function waitForChild(resolve) {
        runtime.child.on('message', function receiveMessage(message: SupervisedChildMessage) {
            handleChildMessage(message, runtime);
        });
        runtime.child.on('error', function recordChildError(error) {
            if (!runtime.terminalFailure.read()) {
                runtime.terminalFailure.write(true);
                runtime.state.recordRunnerError(crashError(runtime.state, error.message));
                runtime.state.recordTerminalActiveCases('crashed');
            }
        });
        runtime.child.on('exit', function resolveExit() {
            resolve();
        });
    });
}

export async function reportRunStart(
    runtime: SupervisedRunRuntime,
    collectedPlan: CollectedRunPlan,
    startedAtMs: number
): Promise<void> {
    await recordReporterEventErrors(
        {
            facts: runtime.resolvedRun.facts,
            kind: 'run-start',
            root: {
                metadata: collectedPlan.root.metadata,
                title: collectedPlan.root.title
            },
            startedAt: runStartTimeFromMilliseconds(startedAtMs)
        },
        runtime.state,
        runtime.reporterDelivery
    );
}

function resultWithSupervisedArtifacts(result: RunResult, runtime: SupervisedRunRuntime): RunResult {
    const artifacts = runtime.state.artifacts();

    if (artifacts.length === 0) {
        return result;
    }

    return {
        ...result,
        artifacts: [ ...result.artifacts, ...artifacts ]
    };
}

function selectRunResult(runtime: SupervisedRunRuntime, startedAtMs: number): RunResult {
    const completedResult = runtime.completedResult.read();

    if (completedResult === null) {
        const collectedPlan = runtime.collectedPlan.read() ?? supervisedCollectedPlan(runtime.resolvedRun);

        return resultWithSupervisedArtifacts(
            createPartialRunResult(collectedPlan, runtime.state, runtime.dependencies, startedAtMs),
            runtime
        );
    }

    return resultWithSupervisedArtifacts(completedResult, runtime);
}

async function reportFinalResult(result: RunResult, runtime: SupervisedRunRuntime): Promise<RunResult> {
    const runEndErrors = await runtime.reporterDelivery.reportEvent({ kind: 'run-end', result });
    const resultForFinalReporting = {
        ...result,
        runnerErrors: [ ...result.runnerErrors, ...runEndErrors ]
    };
    const finalReporterErrors = await runtime.reporterDelivery.reportResult(resultForFinalReporting);
    const disposeErrors = await runtime.reporterDelivery.disposeReporters();

    return {
        ...resultForFinalReporting,
        runnerErrors: [ ...resultForFinalReporting.runnerErrors, ...finalReporterErrors, ...disposeErrors ]
    };
}

export async function finishSupervisedRuntime(runtime: SupervisedRunRuntime, startedAtMs: number): Promise<RunResult> {
    runtime.timeout.clear();
    await runtime.reporterEvents.wait();

    return await reportFinalResult(selectRunResult(runtime, startedAtMs), runtime);
}
