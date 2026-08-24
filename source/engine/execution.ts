import type { WallClock } from '@enormora/wall-clock';
import { createRunResult } from './execution-result.ts';
import { startResourceBudgetTracking } from './execution-resource-budget-tracking.ts';
import {
    createExecutionSupervision,
    executeCaseBody,
    type ConcurrentCase,
    type ExecuteResourceBudgets,
    type ExecuteTimeoutPolicy,
    type ExecutionSupervision
} from './execution-supervision.ts';
import type { TestRuntimePolicy } from './case-execution.ts';
import { createPlainOutputRenderer, type OutputRenderer } from './reporter-output.ts';
import type { ReporterDispatcher } from './reporter-dispatcher.ts';
import { type Reporter, type RunFacts, validateReporterSinks } from './reporter.ts';
import { createReporterEventQueue, type ReporterEventQueue } from './reporter-event-queue.ts';
import type {
    PerTestResult,
    RunResourceUsageTracker,
    RunResult,
    RunnerError
} from './run-result.ts';
import type { TestPlan, TestPlanCase } from './test-plan.ts';

export type ExecuteExecution = {
    readonly mode: 'concurrent-in-process' | 'serial-in-process';
};

export type ExecuteOptions = {
    readonly execution: ExecuteExecution;
    readonly outputRenderer?: OutputRenderer;
    readonly reporters: readonly Reporter[];
    readonly resourceBudgets?: ExecuteResourceBudgets | null;
    readonly resourceUsageTracker?: RunResourceUsageTracker | null;
    readonly runtimePolicy?: TestRuntimePolicy | null;
    readonly runFacts: RunFacts;
    readonly startedAt: string;
    readonly timeoutPolicy?: ExecuteTimeoutPolicy | null;
};

type NormalizedExecuteOptions = ExecuteOptions & {
    readonly outputRenderer: OutputRenderer;
};

export type ExecuteDependencies = {
    readonly reporterDispatcher: ReporterDispatcher;
    readonly wallClock: WallClock;
};

const epoch = new Date(0);

type ExecutedTestPlan = {
    readonly perTest: readonly PerTestResult[];
    readonly reporterErrors: readonly RunnerError[];
};

type ExecutedTestPlanWithResourceUsage = {
    readonly executedTestPlan: ExecutedTestPlan;
    readonly resourceUsage: RunResult['resourceUsage'];
};

type ReportedCase = {
    readonly reporterErrors: readonly RunnerError[];
    readonly result: PerTestResult;
};

type ConcurrentCaseExecution = {
    readonly endReporterErrors: readonly RunnerError[];
    readonly perTest: readonly PerTestResult[];
    readonly runnerErrors: readonly RunnerError[];
};

type ReportTestEndInput = {
    readonly attempt: number;
    readonly result: PerTestResult;
    readonly testCase: TestPlanCase;
    readonly wallTimeMs: number;
};

type ExecuteCaseInput = {
    readonly attempt: number;
    readonly context: ExecutionReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly supervision: ExecutionSupervision;
    readonly testCase: TestPlanCase;
};

type ExecuteConcurrentCasesInput = {
    readonly dependencies: ExecutionDependencies;
    readonly options: NormalizedExecuteOptions;
    readonly reportQueue: ReporterEventQueue;
    readonly supervision: ExecutionSupervision;
    readonly testPlan: TestPlan;
};

type ExecutionDependencies = {
    readonly runtimePolicy: TestRuntimePolicy | null;
    readonly reporterDispatcher: ReporterDispatcher;
    readonly wallClock: WallClock;
};

type ReporterDisposal = {
    readonly disposeOnce: () => Promise<readonly RunnerError[]>;
};

type ExecutionReportingContext = {
    readonly dependencies: ExecutionDependencies;
    readonly outputRenderer: OutputRenderer;
    readonly reporters: readonly Reporter[];
};

async function reportTestStart(
    testCase: TestPlanCase,
    attempt: number,
    context: ExecutionReportingContext
): Promise<readonly RunnerError[]> {
    return await context.dependencies.reporterDispatcher.reportEvent(context.reporters, {
        attempt,
        case: testCase.id,
        kind: 'test-start'
    }, context.outputRenderer);
}

async function reportTestEnd(
    input: ReportTestEndInput,
    context: ExecutionReportingContext
): Promise<readonly RunnerError[]> {
    return await context.dependencies.reporterDispatcher.reportEvent(context.reporters, {
        attempt: input.attempt,
        case: input.testCase.id,
        kind: 'test-end',
        outcome: input.result.outcome,
        verdict: input.result.verdict,
        wallTimeMs: input.wallTimeMs
    }, context.outputRenderer);
}

async function executeCase(input: ExecuteCaseInput): Promise<ReportedCase> {
    const startErrors = await reportTestStart(input.testCase, input.attempt, input.context);
    const executedCase = await executeCaseBody(
        input.testCase,
        input.options.timeoutPolicy,
        input.supervision,
        input.context.dependencies
    );
    const endErrors = await reportTestEnd(
        {
            attempt: input.attempt,
            result: executedCase.result,
            testCase: input.testCase,
            wallTimeMs: executedCase.wallTimeMs
        },
        input.context
    );

    return {
        reporterErrors: [ ...startErrors, ...endErrors ],
        result: executedCase.result
    };
}

function commonSuitePrefixLength(firstSuitePath: readonly string[], secondSuitePath: readonly string[]): number {
    const shortestLength = Math.min(firstSuitePath.length, secondSuitePath.length);
    let prefixLength = 0;

    while (prefixLength < shortestLength && firstSuitePath[prefixLength] === secondSuitePath[prefixLength]) {
        prefixLength += 1;
    }

    return prefixLength;
}

async function reportSuiteTransition(
    context: ExecutionReportingContext,
    currentSuitePath: readonly string[],
    nextSuitePath: readonly string[]
): Promise<readonly RunnerError[]> {
    let reporterErrors: readonly RunnerError[] = [];
    const sharedPrefixLength = commonSuitePrefixLength(currentSuitePath, nextSuitePath);

    for (let pathLength = currentSuitePath.length; pathLength > sharedPrefixLength; pathLength -= 1) {
        reporterErrors = [
            ...reporterErrors,
            ...await context.dependencies.reporterDispatcher.reportEvent(context.reporters, {
                kind: 'suite-end',
                suitePath: currentSuitePath.slice(0, pathLength)
            }, context.outputRenderer)
        ];
    }

    for (let pathLength = sharedPrefixLength + 1; pathLength <= nextSuitePath.length; pathLength += 1) {
        reporterErrors = [
            ...reporterErrors,
            ...await context.dependencies.reporterDispatcher.reportEvent(context.reporters, {
                kind: 'suite-start',
                suitePath: nextSuitePath.slice(0, pathLength)
            }, context.outputRenderer)
        ];
    }

    return reporterErrors;
}

async function executeTestPlanCases(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionDependencies,
    supervision: ExecutionSupervision
): Promise<ExecutedTestPlan> {
    let perTest: readonly PerTestResult[] = [];
    let reporterErrors: readonly RunnerError[] = [];
    let currentSuitePath: readonly string[] = [];

    for (const testCase of testPlan.cases) {
        const suiteErrors = await reportSuiteTransition(
            { dependencies, outputRenderer: options.outputRenderer, reporters: options.reporters },
            currentSuitePath,
            testCase.suitePath
        );
        currentSuitePath = testCase.suitePath;

        const testRun = await executeCase({
            attempt: 0,
            context: { dependencies, outputRenderer: options.outputRenderer, reporters: options.reporters },
            options,
            supervision,
            testCase
        });
        reporterErrors = [ ...reporterErrors, ...suiteErrors, ...testRun.reporterErrors ];
        perTest = [ ...perTest, testRun.result ];
    }

    return {
        perTest,
        reporterErrors: [
            ...reporterErrors,
            ...supervision.runnerErrors,
            ...(options.runtimePolicy?.takeRunErrors() ?? []),
            ...await reportSuiteTransition(
                { dependencies, outputRenderer: options.outputRenderer, reporters: options.reporters },
                currentSuitePath,
                []
            )
        ]
    };
}

async function reportConcurrentCaseStarts(
    testPlan: TestPlan,
    reporters: readonly Reporter[],
    outputRenderer: OutputRenderer,
    dependencies: ExecutionDependencies
): Promise<readonly RunnerError[]> {
    const reportingContext: ExecutionReportingContext = {
        dependencies,
        outputRenderer,
        reporters
    };
    let reporterErrors: readonly RunnerError[] = [];
    let currentSuitePath: readonly string[] = [];

    for (const testCase of testPlan.cases) {
        const suiteErrors = await reportSuiteTransition(
            reportingContext,
            currentSuitePath,
            testCase.suitePath
        );
        const startErrors = await reportTestStart(testCase, 0, reportingContext);
        currentSuitePath = testCase.suitePath;
        reporterErrors = [ ...reporterErrors, ...suiteErrors, ...startErrors ];
    }

    return [
        ...reporterErrors,
        ...await reportSuiteTransition(reportingContext, currentSuitePath, [])
    ];
}

async function reportConcurrentCaseEnd(
    testCase: TestPlanCase,
    executedCase: ConcurrentCase,
    reportQueue: ReporterEventQueue
): Promise<readonly RunnerError[]> {
    return await reportQueue.report({
        attempt: 0,
        case: testCase.id,
        kind: 'test-end',
        outcome: executedCase.result.outcome,
        verdict: executedCase.result.verdict,
        wallTimeMs: executedCase.wallTimeMs
    });
}

async function executeConcurrentCases(input: ExecuteConcurrentCasesInput): Promise<ConcurrentCaseExecution> {
    const endReporterErrors: RunnerError[] = [];
    const caseExecutions = input.testPlan.cases.map(async function executeCaseConcurrently(testCase) {
        const executedCase = await executeCaseBody(
            testCase,
            input.options.timeoutPolicy,
            input.supervision,
            input.dependencies
        );
        endReporterErrors.push(...await reportConcurrentCaseEnd(testCase, executedCase, input.reportQueue));

        return executedCase;
    });
    const executedCases = await Promise.all(caseExecutions);

    return {
        endReporterErrors,
        perTest: executedCases.map(function toPerTest(executedCase) {
            return executedCase.result;
        }),
        runnerErrors: input.supervision.runnerErrors
    };
}

async function executeConcurrentTestPlanCases(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionDependencies,
    supervision: ExecutionSupervision
): Promise<ExecutedTestPlan> {
    const reporterErrors = await reportConcurrentCaseStarts(
        testPlan,
        options.reporters,
        options.outputRenderer,
        dependencies
    );
    const concurrentCaseExecution = await executeConcurrentCases({
        dependencies,
        options,
        reportQueue: createReporterEventQueue(options.reporters, options.outputRenderer, dependencies),
        supervision,
        testPlan
    });

    return {
        perTest: concurrentCaseExecution.perTest,
        reporterErrors: [
            ...reporterErrors,
            ...concurrentCaseExecution.runnerErrors,
            ...(options.runtimePolicy?.takeRunErrors() ?? []),
            ...concurrentCaseExecution.endReporterErrors
        ]
    };
}

async function executeTestPlanCasesWithMode(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionDependencies,
    supervision: ExecutionSupervision
): Promise<ExecutedTestPlan> {
    if (options.execution.mode === 'concurrent-in-process') {
        return await executeConcurrentTestPlanCases(
            testPlan,
            options,
            dependencies,
            supervision
        );
    }

    return await executeTestPlanCases(testPlan, options, dependencies, supervision);
}

async function executeTestPlanCasesAndMeasureResourceUsage(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionDependencies
): Promise<ExecutedTestPlanWithResourceUsage> {
    const supervision = createExecutionSupervision();

    if (options.resourceUsageTracker === null || options.resourceUsageTracker === undefined) {
        return {
            executedTestPlan: await executeTestPlanCasesWithMode(testPlan, options, dependencies, supervision),
            resourceUsage: null
        };
    }

    const resourceBudgetTracking = startResourceBudgetTracking({
        dependencies,
        resourceBudgets: options.resourceBudgets ?? null,
        resourceUsageTracker: options.resourceUsageTracker,
        supervision
    });

    try {
        const executedTestPlan = await executeTestPlanCasesWithMode(testPlan, options, dependencies, supervision);
        const resourceBudgetResult = resourceBudgetTracking.finish();

        return {
            executedTestPlan: {
                ...executedTestPlan,
                reporterErrors: [
                    ...executedTestPlan.reporterErrors,
                    ...resourceBudgetResult.runnerErrors
                ]
            },
            resourceUsage: resourceBudgetResult.resourceUsage
        };
    } catch (error: unknown) {
        resourceBudgetTracking.stop();

        throw error;
    }
}

function appendRunnerErrors(result: RunResult, runnerErrors: readonly RunnerError[]): RunResult {
    if (runnerErrors.length === 0) {
        return result;
    }

    return {
        ...result,
        runnerErrors: [ ...result.runnerErrors, ...runnerErrors ]
    };
}

function executeOptionsWithDefaults(options: ExecuteOptions | undefined): NormalizedExecuteOptions {
    if (options !== undefined) {
        return {
            ...options,
            outputRenderer: options.outputRenderer ?? createPlainOutputRenderer(),
            resourceBudgets: options.resourceBudgets ?? null,
            runtimePolicy: options.runtimePolicy ?? null,
            timeoutPolicy: options.timeoutPolicy ?? null
        };
    }

    return {
        execution: { mode: 'serial-in-process' },
        outputRenderer: createPlainOutputRenderer(),
        reporters: [],
        resourceBudgets: null,
        resourceUsageTracker: null,
        runtimePolicy: null,
        runFacts: {},
        startedAt: epoch.toISOString(),
        timeoutPolicy: null
    };
}

function createReporterDisposal(
    reporters: readonly Reporter[],
    dependencies: ExecuteDependencies
): ReporterDisposal {
    let reportersDisposed = false;

    return {
        async disposeOnce() {
            if (reportersDisposed) {
                return [];
            }

            reportersDisposed = true;

            return await dependencies.reporterDispatcher.disposeReporters(reporters);
        }
    };
}

async function createRunResultBeforeRunEnd(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionDependencies
): Promise<RunResult> {
    const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;
    const startErrors = await dependencies.reporterDispatcher.reportEvent(options.reporters, {
        facts: options.runFacts,
        kind: 'run-start',
        root: testPlan.root,
        startedAt: options.startedAt
    }, options.outputRenderer);
    const { executedTestPlan, resourceUsage } = await executeTestPlanCasesAndMeasureResourceUsage(
        testPlan,
        options,
        dependencies
    );
    const reporterErrors = [ ...startErrors, ...executedTestPlan.reporterErrors ];

    return createRunResult(testPlan, executedTestPlan.perTest, reporterErrors, {
        resourceUsage,
        startedAtMs,
        wallClock: dependencies.wallClock
    });
}

async function executeRun(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionDependencies,
    reporterDisposal: ReporterDisposal
): Promise<RunResult> {
    validateReporterSinks(options.reporters);

    const result = await createRunResultBeforeRunEnd(testPlan, options, dependencies);
    const runEndErrors = await dependencies.reporterDispatcher.reportEvent(options.reporters, {
        kind: 'run-end',
        result
    }, options.outputRenderer);
    const resultForFinalReporting = appendRunnerErrors(result, runEndErrors);
    const finalReporterErrors = await dependencies.reporterDispatcher.reportResult(
        options.reporters,
        resultForFinalReporting,
        options.outputRenderer
    );
    const disposeErrors = await reporterDisposal.disposeOnce();

    return appendRunnerErrors(resultForFinalReporting, [ ...finalReporterErrors, ...disposeErrors ]);
}

async function throwWithCleanupErrors(error: unknown, reporterDisposal: ReporterDisposal): Promise<never> {
    const disposeErrors = await reporterDisposal.disposeOnce();

    if (disposeErrors.length > 0) {
        throw new AggregateError(
            [ error, ...disposeErrors ],
            'Execution failed and reporter cleanup failed.',
            { cause: error }
        );
    }

    throw error;
}

export type Execute = (testPlan: TestPlan, options?: ExecuteOptions) => Promise<RunResult>;

export function createExecute(dependencies: ExecuteDependencies): Execute {
    return async function execute(testPlan, options) {
        const executeOptions = executeOptionsWithDefaults(options);
        const executionDependencies: ExecutionDependencies = {
            ...dependencies,
            runtimePolicy: executeOptions.runtimePolicy
        };
        const reporterDisposal = createReporterDisposal(executeOptions.reporters, dependencies);

        try {
            return await executeRun(testPlan, executeOptions, executionDependencies, reporterDisposal);
        } catch (error: unknown) {
            return await throwWithCleanupErrors(error, reporterDisposal);
        }
    };
}
