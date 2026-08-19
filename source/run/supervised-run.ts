import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { OutputRenderer } from '../engine/reporter-output.ts';
import type { Reporter, ReporterEvent } from '../engine/reporter.ts';
import type {
    PerTestResult,
    ResourceUsageSnapshot,
    RunResult,
    RunnerError
} from '../engine/run-result.ts';
import { createRunResult } from '../engine/execution-result.ts';
import { caseIdentityKey, formatCaseId } from '../engine/identity.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';
import type { ResolvedRun, RunOrchestratorDependencies, RunResourceBudgets } from './run.ts';

type SupervisedChildEvent = {
    readonly event: ReporterEvent;
    readonly kind: 'event';
};

type SupervisedChildResult = {
    readonly kind: 'result';
    readonly result: RunResult;
};

type SupervisedChildSample = {
    readonly kind: 'sample';
    readonly sample: ResourceUsageSnapshot;
};

type SupervisedChildMessage = SupervisedChildEvent | SupervisedChildResult | SupervisedChildSample;

type ResourceBudgetMetric = keyof RunResourceBudgets;

type ResourceBudgetBreach = {
    readonly budget: number;
    readonly metric: ResourceBudgetMetric;
    readonly observed: number;
    readonly sample: ResourceUsageSnapshot;
};

type ActiveCaseMap = Map<string, TestPlanCase>;
type PerTestResults = Map<string, PerTestResult>;
type RunnerErrors = RunnerError[];

type SupervisedRunState = {
    readonly activeCases: ActiveCaseMap;
    readonly perTest: PerTestResults;
    readonly runnerErrors: RunnerErrors;
};

type ReporterContext = {
    readonly outputRenderer: OutputRenderer;
    readonly reporters: readonly Reporter[];
};

const childEntryPoint = fileURLToPath(new URL('./supervised-child.ts', import.meta.url));

function observedBudgetValue(
    metric: ResourceBudgetMetric,
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): number {
    if (metric === 'activeResourceCount') {
        return sample.activeResourceCount;
    }

    if (metric === 'javaScriptEngineHeapBytes') {
        return sample.javaScriptEngineHeapBytes;
    }

    if (metric === 'residentSetBytes') {
        return sample.residentSetBytes;
    }

    if (previousSample === null) {
        return 0;
    }

    const elapsedMilliseconds = sample.capturedAtMilliseconds - previousSample.capturedAtMilliseconds;

    if (elapsedMilliseconds <= 0) {
        return 0;
    }

    return Math.max(0, (sample.residentSetBytes - previousSample.residentSetBytes) * 1000 / elapsedMilliseconds);
}

function findResourceBudgetBreach(
    budgets: RunResourceBudgets,
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): ResourceBudgetBreach | null {
    const metrics: readonly ResourceBudgetMetric[] = [
        'activeResourceCount',
        'javaScriptEngineHeapBytes',
        'residentSetBytes',
        'residentSetGrowthBytesPerSecond'
    ];

    for (const metric of metrics) {
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

    return {
        attributedTo: activeCases.length === 1 ? activeCases[0] ?? null : null,
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

    return {
        attributedTo: activeCases.length === 1 ? activeCases[0] ?? null : null,
        cause: { activeCases, reason },
        message: reason,
        subtype: 'crash'
    };
}

function terminalResult(testCase: TestPlanCase, verdict: PerTestResult['verdict']): PerTestResult {
    return {
        id: testCase.id,
        outcome: null,
        verdict
    };
}

function recordTerminalActiveCases(state: SupervisedRunState, verdict: PerTestResult['verdict']): void {
    for (const [ key, testCase ] of state.activeCases) {
        state.perTest.set(key, terminalResult(testCase, verdict));
    }

    state.activeCases.clear();
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
        state.runnerErrors.push(...errors);
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
            state.activeCases.set(caseIdentityKey(event.case), testCase);
        }
    } else if (event.kind === 'test-end') {
        const key = caseIdentityKey(event.case);
        state.activeCases.delete(key);
        state.perTest.set(key, {
            id: event.case,
            outcome: event.outcome,
            verdict: event.verdict
        });
    } else if (event.kind === 'runner-error') {
        state.runnerErrors.push(event.error);
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
        Array.from(state.perTest.values()),
        state.runnerErrors,
        {
            resourceUsage: null,
            startedAtMs,
            wallClock: dependencies.wallClock
        }
    );
}

function kill(child: ChildProcess): void {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
    }
}

export async function executeSupervisedRun(
    resolvedRun: ResolvedRun,
    dependencies: RunOrchestratorDependencies
): Promise<RunResult> {
    const reporterContext: ReporterContext = {
        outputRenderer: resolvedRun.config.outputRenderer,
        reporters: resolvedRun.reporters
    };
    const state: SupervisedRunState = {
        activeCases: new Map(),
        perTest: new Map(),
        runnerErrors: []
    };
    const cases = caseByKey(resolvedRun.testPlan);
    const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;
    const child = fork(childEntryPoint, [], {
        cwd: resolvedRun.cwd,
        stdio: [ 'inherit', 'inherit', 'inherit', 'ipc' ]
    });
    let previousSample: ResourceUsageSnapshot | null = null;
    let completedResult: RunResult | null = null;
    let terminalFailureRecorded = false;
    let hardTimeout: ReturnType<RunOrchestratorDependencies['wallClock']['setTimeout']> | null = null;

    function clearHardTimeout(): void {
        if (hardTimeout !== null) {
            dependencies.wallClock.clearTimeout(hardTimeout);
            hardTimeout = null;
        }
    }

    function startHardTimeout(): void {
        if (hardTimeout !== null || state.activeCases.size === 0) {
            return;
        }

        hardTimeout = dependencies.wallClock.setTimeout(function killHardTimedOutChild() {
            terminalFailureRecorded = true;
            state.runnerErrors.push(crashError(state, 'Supervised child exceeded hard timeout.'));
            recordTerminalActiveCases(state, 'crashed');
            kill(child);
        }, resolvedRun.facts.execution.resourceUsagePolicy.hardTimeoutMilliseconds);
    }

    await recordReporterEventErrors(
        {
            facts: resolvedRun.facts,
            kind: 'run-start',
            root: resolvedRun.testPlan.root,
            startedAt: dependencies.readStartedAt()
        },
        state,
        reporterContext,
        dependencies
    );

    const childFinished = new Promise<void>(function waitForChild(resolve) {
        child.on('message', function receiveMessage(message: SupervisedChildMessage) {
            if (message.kind === 'event') {
                applyEvent(message.event, state, cases);
                if (message.event.kind === 'test-start') {
                    startHardTimeout();
                } else if (message.event.kind === 'test-end' && state.activeCases.size === 0) {
                    clearHardTimeout();
                }
                void recordReporterEventErrors(message.event, state, reporterContext, dependencies);
            } else if (message.kind === 'sample') {
                if (terminalFailureRecorded) {
                    return;
                }

                const breach = findResourceBudgetBreach(
                    resolvedRun.facts.execution.resourceUsagePolicy.resourceBudgets,
                    message.sample,
                    previousSample
                );
                previousSample = message.sample;

                if (breach !== null) {
                    terminalFailureRecorded = true;
                    const error = resourceExhaustionError(breach, state);
                    state.runnerErrors.push(error);
                    void recordReporterEventErrors(
                        { error, kind: 'runner-error' },
                        state,
                        reporterContext,
                        dependencies
                    );
                    recordTerminalActiveCases(state, 'resource-exhausted');
                    clearHardTimeout();
                    kill(child);
                }
            } else {
                completedResult = {
                    ...message.result,
                    runnerErrors: [ ...state.runnerErrors, ...message.result.runnerErrors ]
                };
            }
        });
        child.on('error', function recordChildError(error) {
            if (!terminalFailureRecorded) {
                terminalFailureRecorded = true;
                state.runnerErrors.push(crashError(state, error.message));
                recordTerminalActiveCases(state, 'crashed');
            }
        });
        child.on('exit', function resolveExit() {
            resolve();
        });
    });

    child.send?.({
        assignedCaseKeys: resolvedRun.testPlan.cases.map(function toCaseKey(testCase) {
            return formatCaseId(testCase.id);
        }),
        cwd: resolvedRun.cwd,
        hardTimeoutMilliseconds: resolvedRun.facts.execution.resourceUsagePolicy.hardTimeoutMilliseconds,
        kind: 'run',
        paths: resolvedRun.request.paths,
        resourceBudgets: resolvedRun.facts.execution.resourceUsagePolicy.resourceBudgets,
        resourceUsageSamplingIntervalMilliseconds: resolvedRun
            .facts
            .execution
            .resourceUsagePolicy
            .resourceUsageSamplingIntervalMilliseconds,
        timeoutMilliseconds: resolvedRun.facts.execution.resourceUsagePolicy.timeoutMilliseconds
    });

    await childFinished;
    clearHardTimeout();

    const result = completedResult ?? createPartialRunResult(resolvedRun, state, dependencies, startedAtMs);
    const runEndErrors = await dependencies.reporterDispatcher.reportEvent(
        reporterContext.reporters,
        { kind: 'run-end', result },
        reporterContext.outputRenderer
    );
    const resultForFinalReporting = {
        ...result,
        runnerErrors: [ ...result.runnerErrors, ...runEndErrors ]
    };
    const finalReporterErrors = await dependencies.reporterDispatcher.reportResult(
        reporterContext.reporters,
        resultForFinalReporting,
        reporterContext.outputRenderer
    );
    const disposeErrors = await dependencies.reporterDispatcher.disposeReporters(reporterContext.reporters);

    return {
        ...resultForFinalReporting,
        runnerErrors: [ ...resultForFinalReporting.runnerErrors, ...finalReporterErrors, ...disposeErrors ]
    };
}
