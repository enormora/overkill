import type { OutputRenderer } from '../engine/reporter-output.ts';
import type { Reporter, ReporterEvent } from '../engine/reporter.ts';
import type {
    ResourceUsageSnapshot,
    RunResult,
    RunnerError
} from '../engine/run-result.ts';
import { caseIdentityKey, type CaseId } from '../engine/identity.ts';
import {
    collectedRunCaseIds,
    createRunResultFromCollectedPlan
} from './collected-run-plan.ts';
import type {
    CollectedRunPlan,
    ResolvedRun,
    RunOrchestratorDependencies,
    RunResourceBudgets
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
    createStoredRunValue,
    createSupervisedRunState,
    deduplicatedChildRuntimePolicyErrors,
    type SupervisedCase,
    type StoredRunValue,
    type SupervisedRunState
} from './supervised-run-state.ts';

type ResourceBudgetMetric = keyof RunResourceBudgets;

function runStartTimeFromMilliseconds(milliseconds: number): string {
    const startedAt = new Date(milliseconds);

    return startedAt.toISOString();
}

type ResourceBudgetBreach = {
    readonly budget: number;
    readonly metric: ResourceBudgetMetric;
    readonly observed: number;
    readonly sample: ResourceUsageSnapshot;
};

type BudgetValueReader = (
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
) => number;

type ReporterContext = {
    readonly outputRenderer: OutputRenderer;
    readonly reporters: readonly Reporter[];
};

type ReporterEventQueue = {
    readonly add: (eventReport: Promise<void>) => void;
    readonly wait: () => Promise<void>;
};

type SupervisedHardTimeout = {
    readonly clear: () => void;
    readonly start: () => void;
};

type SupervisedRunRuntimeSeed = {
    readonly child: SupervisedChildProcess;
    readonly collectedPlan: StoredRunValue<CollectedRunPlan | null>;
    readonly completedResult: StoredRunValue<RunResult | null>;
    readonly dependencies: RunOrchestratorDependencies;
    readonly previousSample: StoredRunValue<ResourceUsageSnapshot | null>;
    readonly reporterContext: ReporterContext;
    readonly reporterEvents: ReporterEventQueue;
    readonly resolvedRun: ResolvedRun;
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
};

type SupervisedRunRuntime = SupervisedRunRuntimeSeed & {
    readonly timeout: SupervisedHardTimeout;
};

type SupervisedCollectionResult = {
    readonly collectedPlan: CollectedRunPlan;
    readonly runnerErrors: readonly RunnerError[];
};

type CreateResolvedRunFromCollection = (
    collection: SupervisedCollectionResult
) => ResolvedRun;

type SupervisedCollectionRuntime = {
    readonly child: SupervisedChildProcess;
    readonly command: SupervisedCollectCommand | SupervisedRunCommand;
    readonly collected: StoredRunValue<SupervisedCollectionResult | null>;
    readonly dependencies: RunOrchestratorDependencies;
    readonly previousSample: StoredRunValue<ResourceUsageSnapshot | null>;
    readonly state: SupervisedRunState;
    readonly terminalFailure: StoredRunValue<boolean>;
};

const millisecondsPerSecond = 1000;
const resourceBudgetMetrics: readonly ResourceBudgetMetric[] = [
    'activeResourceCount',
    'javaScriptEngineHeapBytes',
    'residentSetBytes',
    'residentSetGrowthBytesPerSecond'
];

function createReporterEventQueue(): ReporterEventQueue {
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

function observedResidentSetGrowth(
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): number {
    if (previousSample === null) {
        return 0;
    }

    const elapsedMilliseconds = sample.capturedAtMilliseconds - previousSample.capturedAtMilliseconds;

    if (elapsedMilliseconds <= 0) {
        return 0;
    }

    return Math.max(
        0,
        (sample.residentSetBytes - previousSample.residentSetBytes) * millisecondsPerSecond / elapsedMilliseconds
    );
}

const budgetValueReaders: Readonly<Record<ResourceBudgetMetric, BudgetValueReader>> = {
    activeResourceCount(sample) {
        return sample.activeResourceCount;
    },
    javaScriptEngineHeapBytes(sample) {
        return sample.javaScriptEngineHeapBytes;
    },
    residentSetBytes(sample) {
        return sample.residentSetBytes;
    },
    residentSetGrowthBytesPerSecond: observedResidentSetGrowth
};

function observedBudgetValue(
    metric: ResourceBudgetMetric,
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): number {
    return budgetValueReaders[metric](sample, previousSample);
}

function findResourceBudgetBreach(
    budgets: RunResourceBudgets,
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): ResourceBudgetBreach | null {
    for (const metric of resourceBudgetMetrics) {
        const budget = budgets[metric];

        if (budget !== null) {
            const observed = observedBudgetValue(metric, sample, previousSample);

            if (observed > budget) {
                return { budget, metric, observed, sample };
            }
        }
    }

    return null;
}

function activeCaseIds(state: SupervisedRunState): readonly CaseId[] {
    return Array.from(state.activeCases.values(), function toCaseId(testCase) {
        return testCase.id;
    });
}

function resourceExhaustionError(breach: ResourceBudgetBreach, state: SupervisedRunState): RunnerError {
    const activeCases = activeCaseIds(state);
    const [ activeCase = null ] = activeCases;

    return {
        attributedTo: activeCases.length === 1 ? activeCase : null,
        cause: {
            ...breach,
            activeCases,
            enforcement: activeCases.length === 0 ? 'post-test-diagnostic' : 'sampled'
        },
        message: `Resource budget exceeded: ${breach.metric} observed ${breach.observed}, budget ${breach.budget}.`,
        subtype: 'resource-exhaustion'
    };
}

function crashError(state: SupervisedRunState, reason: string): RunnerError {
    const activeCases = activeCaseIds(state);
    const [ activeCase = null ] = activeCases;

    return {
        attributedTo: activeCases.length === 1 ? activeCase : null,
        cause: { activeCases, reason },
        message: reason,
        subtype: 'crash'
    };
}

async function recordReporterEventErrors(
    event: ReporterEvent,
    state: SupervisedRunState,
    context: ReporterContext,
    dependencies: RunOrchestratorDependencies
): Promise<void> {
    const errors = await dependencies.reporterDispatcher.reportEvent(
        context.reporters,
        event,
        context.outputRenderer
    );

    if (errors.length > 0) {
        state.recordRunnerErrors(errors);
    }
}

function caseByKey(collectedPlan: CollectedRunPlan): ReadonlyMap<string, SupervisedCase> {
    return new Map(
        collectedRunCaseIds(collectedPlan).map(function toEntry(id) {
            return [ caseIdentityKey(id), { id } ];
        })
    );
}

function applyEvent(event: ReporterEvent, state: SupervisedRunState, cases: ReadonlyMap<string, SupervisedCase>): void {
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

function kill(child: SupervisedChildProcess): void {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
    }
}

function createReporterContext(resolvedRun: ResolvedRun): ReporterContext {
    return {
        outputRenderer: resolvedRun.config.outputRenderer,
        reporters: resolvedRun.reporters
    };
}

function supervisedCollectedPlan(resolvedRun: ResolvedRun): CollectedRunPlan {
    if (resolvedRun.plan.kind !== 'supervised') {
        throw new Error('Supervised execution requires a supervised collected plan.');
    }

    return resolvedRun.plan.collectedPlan;
}

function createHardTimeout(runtime: SupervisedRunRuntimeSeed): SupervisedHardTimeout {
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

function createRunCommand(resolvedRun: ResolvedRun): SupervisedRunCommand {
    return {
        capabilityRestrictions: resolvedRun.request.capabilityRestrictions,
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
        timeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.softMilliseconds
    };
}

function sendRunCommand(runtime: SupervisedRunRuntime): void {
    runtime.child.send(createRunCommand(runtime.resolvedRun));
}

function sendAssignment(runtime: SupervisedRunRuntime): void {
    const collectedPlan = runtime.collectedPlan.read() ?? supervisedCollectedPlan(runtime.resolvedRun);

    runtime.child.send({
        assignedCases: collectedRunCaseIds(collectedPlan),
        kind: 'assign'
    });
}

function handleChildEvent(event: ReporterEvent, runtime: SupervisedRunRuntime): void {
    const collectedPlan = runtime.collectedPlan.read();

    if (collectedPlan !== null) {
        applyEvent(event, runtime.state, caseByKey(collectedPlan));
    }

    if (event.kind === 'test-start') {
        runtime.timeout.start();
    } else if (event.kind === 'test-end' && runtime.state.activeCases.size === 0) {
        runtime.timeout.clear();
    }

    runtime.reporterEvents.add(recordReporterEventErrors(
        event,
        runtime.state,
        runtime.reporterContext,
        runtime.dependencies
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
        runtime.reporterContext,
        runtime.dependencies
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

function handleChildMessage(message: SupervisedChildMessage, runtime: SupervisedRunRuntime): void {
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

async function observeChild(runtime: SupervisedRunRuntime): Promise<void> {
    observeSupervisedChildOutput(runtime);

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

function handleCollectionSample(sample: ResourceUsageSnapshot, runtime: SupervisedCollectionRuntime): void {
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

function handleCollectionMessage(message: SupervisedChildMessage, runtime: SupervisedCollectionRuntime): void {
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

async function observeCollection(runtime: SupervisedCollectionRuntime): Promise<void> {
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
): Promise<SupervisedCollectionRuntime> {
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

function readCollectedResult(runtime: SupervisedCollectionRuntime): SupervisedCollectionResult {
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
    const child = await startSupervisedChild({
        capabilityRestrictions: command.capabilityRestrictions,
        cwd: command.cwd
    }, dependencies);
    const state = createSupervisedRunState();
    const terminalFailure = createStoredRunValue(false);
    const previousSample = createStoredRunValue<ResourceUsageSnapshot | null>(null);
    const collected = createStoredRunValue<SupervisedCollectionResult | null>(null);
    const reporterEvents = createReporterEventQueue();
    const completedResult = createStoredRunValue<RunResult | null>(null);
    let runtime: SupervisedRunRuntime | null = null;
    let resolveCollected: () => void = function missingCollectionResolver() {
        return undefined;
    };
    const collectedSignal = new Promise<void>(function waitForCollected(resolve) {
        resolveCollected = resolve;
    });
    let resolveFinished: () => void = function missingFinishedResolver() {
        return undefined;
    };
    const finishedSignal = new Promise<void>(function waitForFinished(resolve) {
        resolveFinished = resolve;
    });
    const collectionTimeout = dependencies.wallClock.setTimeout(function killTimedOutCollection() {
        terminalFailure.write(true);
        state.recordRunnerError({
            attributedTo: null,
            cause: { reason: 'Supervised collection exceeded collection timeout.' },
            message: 'Supervised collection exceeded collection timeout.',
            subtype: 'crash'
        });
        kill(child);
        resolveCollected();
    }, command.collectionTimeoutMilliseconds);

    observeSupervisedChildOutput({ child, state, terminalFailure });
    child.on('message', function receiveMessage(message: SupervisedChildMessage) {
        if (runtime !== null) {
            handleChildMessage(message, runtime);
            return;
        }

        if (message.kind === 'collected') {
            dependencies.wallClock.clearTimeout(collectionTimeout);
            collected.write({
                collectedPlan: message.collectedPlan,
                runnerErrors: message.runnerErrors
            });
            resolveCollected();
        } else if (message.kind === 'sample') {
            const collectionRuntime: SupervisedCollectionRuntime = {
                child,
                command,
                collected,
                dependencies,
                previousSample,
                state,
                terminalFailure
            };
            handleCollectionSample(message.sample, collectionRuntime);
        } else if (message.kind === 'event') {
            applyEvent(message.event, state, new Map());
        }
    });
    child.on('error', function recordChildError(error) {
        terminalFailure.write(true);
        state.recordRunnerError({
            attributedTo: null,
            cause: error,
            message: error.message,
            subtype: 'crash'
        });
        resolveCollected();
    });
    child.on('exit', function resolveExit() {
        dependencies.wallClock.clearTimeout(collectionTimeout);
        resolveCollected();
        resolveFinished();
    });

    child.send(command);
    await collectedSignal;
    const collection = collected.read();

    if (collection === null || terminalFailure.read()) {
        await finishedSignal;
        throw new RunCollectionError(
            state.runnerErrors()[0]?.message ?? 'Supervised collection failed.',
            { cause: state.runnerErrors()[0] ?? null },
            'loader'
        );
    }

    const resolvedRun = createResolvedRun({
        collectedPlan: collection.collectedPlan,
        runnerErrors: collection.runnerErrors
    });
    const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;
    const runtimeWithoutTimeout = {
        child,
        collectedPlan: createStoredRunValue<CollectedRunPlan | null>(collection.collectedPlan),
        completedResult,
        dependencies,
        previousSample,
        reporterContext: createReporterContext(resolvedRun),
        reporterEvents,
        resolvedRun,
        state,
        terminalFailure
    };
    runtime = {
        ...runtimeWithoutTimeout,
        timeout: createHardTimeout(runtimeWithoutTimeout)
    };
    state.recordRunnerErrors(resolvedRun.collectionRunnerErrors);
    await recordReporterEventErrors(
        {
            facts: resolvedRun.facts,
            kind: 'run-start',
            root: {
                metadata: {},
                name: collection.collectedPlan.root.name
            },
            startedAt: runStartTimeFromMilliseconds(startedAtMs)
        },
        state,
        runtime.reporterContext,
        dependencies
    );
    child.send({
        assignedCases: collectedRunCaseIds(collection.collectedPlan),
        kind: 'assign'
    });
    await finishedSignal;
    runtime.timeout.clear();
    await reporterEvents.wait();

    return reportFinalResult(selectRunResult(runtime, startedAtMs), runtime);
}

function selectRunResult(runtime: SupervisedRunRuntime, startedAtMs: number): RunResult {
    const completedResult = runtime.completedResult.read();

    if (completedResult === null) {
        const collectedPlan = runtime.collectedPlan.read() ?? supervisedCollectedPlan(runtime.resolvedRun);

        return createPartialRunResult(collectedPlan, runtime.state, runtime.dependencies, startedAtMs);
    }

    return completedResult;
}

async function reportFinalResult(result: RunResult, runtime: SupervisedRunRuntime): Promise<RunResult> {
    const runEndErrors = await runtime.dependencies.reporterDispatcher.reportEvent(
        runtime.reporterContext.reporters,
        { kind: 'run-end', result },
        runtime.reporterContext.outputRenderer
    );
    const resultForFinalReporting = {
        ...result,
        runnerErrors: [ ...result.runnerErrors, ...runEndErrors ]
    };
    const finalReporterErrors = await runtime.dependencies.reporterDispatcher.reportResult(
        runtime.reporterContext.reporters,
        resultForFinalReporting,
        runtime.reporterContext.outputRenderer
    );
    const disposeErrors = await runtime.dependencies.reporterDispatcher.disposeReporters(
        runtime.reporterContext.reporters
    );

    return {
        ...resultForFinalReporting,
        runnerErrors: [ ...resultForFinalReporting.runnerErrors, ...finalReporterErrors, ...disposeErrors ]
    };
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
    await recordReporterEventErrors(
        {
            facts: resolvedRun.facts,
            kind: 'run-start',
            root: {
                metadata: {},
                name: collectedPlan.root.name
            },
            startedAt: runStartTimeFromMilliseconds(startedAtMs)
        },
        runtime.state,
        runtime.reporterContext,
        dependencies
    );

    const childFinished = observeChild(runtime);
    sendRunCommand(runtime);
    sendAssignment(runtime);
    await childFinished;
    runtime.timeout.clear();
    await runtime.reporterEvents.wait();

    return reportFinalResult(selectRunResult(runtime, startedAtMs), runtime);
}
