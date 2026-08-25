import type { OutputRenderer } from '../engine/reporter-output.ts';
import type { Reporter, ReporterEvent } from '../engine/reporter.ts';
import type {
    ResourceUsageSnapshot,
    RunResult,
    RunnerError
} from '../engine/run-result.ts';
import { createRunResult } from '../engine/execution-result.ts';
import { caseIdentityKey, formatCaseId } from '../engine/identity.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';
import type { ResolvedRun, RunOrchestratorDependencies, RunResourceBudgets } from './run-types.ts';
import type { SupervisedChildMessage, SupervisedRunCommand } from './supervised-protocol.ts';
import {
    observeSupervisedChildOutput,
    startSupervisedChild,
    type SupervisedChildProcess
} from './supervised-child-process.ts';
import {
    createStoredRunValue,
    createSupervisedRunState,
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
    readonly cases: ReadonlyMap<string, TestPlanCase>;
    readonly child: SupervisedChildProcess;
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

function activeCaseIds(state: SupervisedRunState): readonly TestPlanCase['id'][] {
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

function caseByKey(testPlan: TestPlan): ReadonlyMap<string, TestPlanCase> {
    return new Map(testPlan.cases.map(function toEntry(testCase) {
        return [ caseIdentityKey(testCase.id), testCase ];
    }));
}

function applyEvent(event: ReporterEvent, state: SupervisedRunState, cases: ReadonlyMap<string, TestPlanCase>): void {
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
    resolvedRun: ResolvedRun,
    state: SupervisedRunState,
    dependencies: RunOrchestratorDependencies,
    startedAtMs: number
): RunResult {
    return createRunResult(
        resolvedRun.testPlan,
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

function createRunCommand(resolvedRun: ResolvedRun): SupervisedRunCommand {
    return {
        assignedCaseKeys: resolvedRun.testPlan.cases.map(function toCaseKey(testCase) {
            return formatCaseId(testCase.id);
        }),
        capabilityRestrictions: resolvedRun.request.capabilityRestrictions,
        cwd: resolvedRun.cwd,
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

function handleChildEvent(event: ReporterEvent, runtime: SupervisedRunRuntime): void {
    applyEvent(event, runtime.state, runtime.cases);

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

function runtimePolicyCapability(error: RunnerError): string | null {
    const { cause } = error;

    if (typeof cause !== 'object' || cause === null || !Object.hasOwn(cause, 'capability')) {
        return null;
    }

    const capability: unknown = Reflect.get(cause, 'capability');

    return typeof capability === 'string' ? capability : null;
}

function attributedCaseKey(error: RunnerError): string {
    return error.attributedTo === null ? 'out-of-test' : caseIdentityKey(error.attributedTo);
}

function supervisedPolicyErrorKey(error: RunnerError): string | null {
    const capability = runtimePolicyCapability(error);

    return error.subtype === 'runtime-policy' && capability === 'process-env'
        ? `${capability}:${attributedCaseKey(error)}`
        : null;
}

function childRuntimePolicyErrors(
    childErrors: readonly RunnerError[],
    supervisorErrors: readonly RunnerError[]
): readonly RunnerError[] {
    const supervisorKeys = new Set(supervisorErrors.flatMap(function toPolicyKey(error) {
        const key = supervisedPolicyErrorKey(error);

        return key === null ? [] : [ key ];
    }));

    return childErrors.filter(function notDuplicatedBySupervisor(error) {
        const key = supervisedPolicyErrorKey(error);

        return key === null || !supervisorKeys.has(key);
    });
}

function handleCompletedResult(result: RunResult, runtime: SupervisedRunRuntime): void {
    const supervisorErrors = runtime.state.runnerErrors();

    runtime.completedResult.write({
        ...result,
        runnerErrors: [ ...supervisorErrors, ...childRuntimePolicyErrors(result.runnerErrors, supervisorErrors) ]
    });
}

function handleChildMessage(message: SupervisedChildMessage, runtime: SupervisedRunRuntime): void {
    if (message.kind === 'event') {
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

function selectRunResult(runtime: SupervisedRunRuntime, startedAtMs: number): RunResult {
    const completedResult = runtime.completedResult.read();

    if (completedResult === null) {
        return createPartialRunResult(runtime.resolvedRun, runtime.state, runtime.dependencies, startedAtMs);
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
    const runtimeWithoutTimeout = {
        cases: caseByKey(resolvedRun.testPlan),
        child: await startSupervisedChild(resolvedRun, dependencies),
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
    await recordReporterEventErrors(
        {
            facts: resolvedRun.facts,
            kind: 'run-start',
            root: resolvedRun.testPlan.root,
            startedAt: runStartTimeFromMilliseconds(startedAtMs)
        },
        runtime.state,
        runtime.reporterContext,
        dependencies
    );

    const childFinished = observeChild(runtime);
    sendRunCommand(runtime);
    await childFinished;
    runtime.timeout.clear();
    await runtime.reporterEvents.wait();

    return reportFinalResult(selectRunResult(runtime, startedAtMs), runtime);
}
