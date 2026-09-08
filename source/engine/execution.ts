import type { WallClock } from '@enormora/wall-clock';
import { createRunResult } from './execution-result.ts';
import { startResourceBudgetTracking } from './execution-resource-budget-tracking.ts';
import {
    createExecutionSupervision,
    executeCaseBody,
    type ConcurrentCase,
    type ExecuteResourceBudgets,
    type ExecuteTimeoutPolicy,
    type ExecutionSupervision,
    type ExecutionSupervisionDependencies
} from './execution-supervision.ts';
import { createPlainOutputRenderer, type DefinedOutputRenderer } from './reporter-output.ts';
import {
    createReporterDisposal,
    type ReporterDelivery,
    type ReporterDispatcher,
    type ReporterDisposal
} from './reporter-dispatcher.ts';
import type { DefinedReporter, RunFacts } from './reporter.ts';
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
    readonly outputRenderer?: DefinedOutputRenderer;
    readonly reporters: readonly DefinedReporter[];
    readonly resourceBudgets?: ExecuteResourceBudgets | null;
    readonly resourceUsageTracker?: RunResourceUsageTracker | null;
    readonly runtimePolicy?: RuntimePolicy | null;
    readonly runFacts: RunFacts;
    readonly startedAt: string;
    readonly timeoutPolicy?: ExecuteTimeoutPolicy | null;
};

type NormalizedExecuteOptions = ExecuteOptions & {
    readonly outputRenderer: DefinedOutputRenderer;
    readonly runtimePolicy: RuntimePolicy | null;
};

type RuntimePolicy = NonNullable<ExecutionSupervisionDependencies['runtimePolicy']>;

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

type ExecuteTestPlanCasesInput = {
    readonly context: ExecutionReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly supervision: ExecutionSupervision;
    readonly testPlan: TestPlan;
};

type ExecuteConcurrentCasesInput = {
    readonly context: ExecutionReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly reportQueue: ReporterEventQueue;
    readonly supervision: ExecutionSupervision;
    readonly testPlan: TestPlan;
};

type ExecuteRunInput = {
    readonly context: ExecutionReportingContext;
    readonly options: NormalizedExecuteOptions;
    readonly reporterDisposal: ReporterDisposal;
    readonly testPlan: TestPlan;
};

type ExecutionDependencies = {
    readonly runtimePolicy: RuntimePolicy | null;
    readonly reporterDispatcher: ReporterDispatcher;
    readonly wallClock: WallClock;
};

type ExecutionReportingContext = {
    readonly dependencies: ExecutionDependencies;
    readonly reporterDelivery: ReporterDelivery;
};

async function reportTestStart(
    testCase: TestPlanCase,
    attempt: number,
    context: ExecutionReportingContext
): Promise<readonly RunnerError[]> {
    return await context.reporterDelivery.reportEvent({
        attempt,
        case: testCase.id,
        definitionLocations: testCase.definitionLocations,
        kind: 'test-start',
        suitePath: testCase.suitePath
    });
}

async function reportTestEnd(
    input: ReportTestEndInput,
    context: ExecutionReportingContext
): Promise<readonly RunnerError[]> {
    return await context.reporterDelivery.reportEvent({
        attempt: input.attempt,
        artifacts: [],
        case: input.testCase.id,
        definitionLocations: input.testCase.definitionLocations,
        kind: 'test-end',
        outcome: input.result.outcome,
        suitePath: input.testCase.suitePath,
        verdict: input.result.verdict,
        wallTimeMs: input.wallTimeMs
    });
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

function commonSuitePrefixLength(
    firstSuitePath: TestPlanCase['suitePath'],
    secondSuitePath: TestPlanCase['suitePath']
): number {
    const shortestLength = Math.min(firstSuitePath.length, secondSuitePath.length);
    let prefixLength = 0;

    while (
        prefixLength < shortestLength &&
        firstSuitePath[prefixLength]?.title === secondSuitePath[prefixLength]?.title
    ) {
        prefixLength += 1;
    }

    return prefixLength;
}

async function reportSuiteTransition(
    context: ExecutionReportingContext,
    currentSuitePath: TestPlanCase['suitePath'],
    nextSuitePath: TestPlanCase['suitePath']
): Promise<readonly RunnerError[]> {
    let reporterErrors: readonly RunnerError[] = [];
    const sharedPrefixLength = commonSuitePrefixLength(currentSuitePath, nextSuitePath);

    for (let pathLength = currentSuitePath.length; pathLength > sharedPrefixLength; pathLength -= 1) {
        reporterErrors = [
            ...reporterErrors,
            ...await context.reporterDelivery.reportEvent({
                kind: 'suite-end',
                suitePath: currentSuitePath.slice(0, pathLength)
            })
        ];
    }

    for (let pathLength = sharedPrefixLength + 1; pathLength <= nextSuitePath.length; pathLength += 1) {
        reporterErrors = [
            ...reporterErrors,
            ...await context.reporterDelivery.reportEvent({
                kind: 'suite-start',
                suitePath: nextSuitePath.slice(0, pathLength)
            })
        ];
    }

    return reporterErrors;
}

async function executeTestPlanCases(input: ExecuteTestPlanCasesInput): Promise<ExecutedTestPlan> {
    let perTest: readonly PerTestResult[] = [];
    let reporterErrors: readonly RunnerError[] = [];
    let currentSuitePath: TestPlanCase['suitePath'] = [];

    for (const testCase of input.testPlan.cases) {
        const suiteErrors = await reportSuiteTransition(
            input.context,
            currentSuitePath,
            testCase.suitePath
        );
        currentSuitePath = testCase.suitePath;

        const testRun = await executeCase({
            attempt: 0,
            context: input.context,
            options: input.options,
            supervision: input.supervision,
            testCase
        });
        reporterErrors = [ ...reporterErrors, ...suiteErrors, ...testRun.reporterErrors ];
        perTest = [ ...perTest, testRun.result ];
    }

    return {
        perTest,
        reporterErrors: [
            ...reporterErrors,
            ...input.supervision.runnerErrors,
            ...input.options.runtimePolicy?.takeRunErrors() ?? [],
            ...await reportSuiteTransition(
                input.context,
                currentSuitePath,
                []
            )
        ]
    };
}

async function reportConcurrentCaseStarts(
    testPlan: TestPlan,
    reporterDelivery: ReporterDelivery,
    dependencies: ExecutionDependencies
): Promise<readonly RunnerError[]> {
    const reportingContext: ExecutionReportingContext = {
        dependencies,
        reporterDelivery
    };
    let reporterErrors: readonly RunnerError[] = [];
    let currentSuitePath: TestPlanCase['suitePath'] = [];

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
        artifacts: [],
        case: testCase.id,
        definitionLocations: testCase.definitionLocations,
        kind: 'test-end',
        outcome: executedCase.result.outcome,
        suitePath: testCase.suitePath,
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
            input.context.dependencies
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

async function executeConcurrentTestPlanCases(input: ExecuteTestPlanCasesInput): Promise<ExecutedTestPlan> {
    const reporterErrors = await reportConcurrentCaseStarts(
        input.testPlan,
        input.context.reporterDelivery,
        input.context.dependencies
    );
    const concurrentCaseExecution = await executeConcurrentCases({
        context: input.context,
        options: input.options,
        reportQueue: createReporterEventQueue(input.context.reporterDelivery),
        supervision: input.supervision,
        testPlan: input.testPlan
    });

    return {
        perTest: concurrentCaseExecution.perTest,
        reporterErrors: [
            ...reporterErrors,
            ...concurrentCaseExecution.runnerErrors,
            ...input.options.runtimePolicy?.takeRunErrors() ?? [],
            ...concurrentCaseExecution.endReporterErrors
        ]
    };
}

async function executeTestPlanCasesWithMode(input: ExecuteTestPlanCasesInput): Promise<ExecutedTestPlan> {
    if (input.options.execution.mode === 'concurrent-in-process') {
        return await executeConcurrentTestPlanCases(input);
    }

    return await executeTestPlanCases(input);
}

async function executeTestPlanCasesWithResourceBudgetTracking(
    input: ExecuteTestPlanCasesInput
): Promise<ExecutedTestPlanWithResourceUsage> {
    const { resourceUsageTracker } = input.options;

    if (resourceUsageTracker === null || resourceUsageTracker === undefined) {
        return {
            executedTestPlan: await executeTestPlanCasesWithMode(input),
            resourceUsage: null
        };
    }

    const resourceBudgetTracking = startResourceBudgetTracking({
        dependencies: input.context.dependencies,
        resourceBudgets: input.options.resourceBudgets ?? null,
        resourceUsageTracker,
        supervision: input.supervision
    });

    try {
        const executedTestPlan = await executeTestPlanCasesWithMode(input);
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

async function executeTestPlanCasesAndMeasureResourceUsage(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionDependencies,
    reporterDelivery: ReporterDelivery
): Promise<ExecutedTestPlanWithResourceUsage> {
    const supervision = createExecutionSupervision();
    const input: ExecuteTestPlanCasesInput = {
        context: { dependencies, reporterDelivery },
        options,
        supervision,
        testPlan
    };

    return await executeTestPlanCasesWithResourceBudgetTracking(input);
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

async function createRunResultBeforeRunEnd(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionDependencies,
    reporterDelivery: ReporterDelivery
): Promise<RunResult> {
    const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;
    const startErrors = await reporterDelivery.reportEvent({
        facts: options.runFacts,
        kind: 'run-start',
        root: testPlan.root,
        startedAt: options.startedAt
    });
    const { executedTestPlan, resourceUsage } = await executeTestPlanCasesAndMeasureResourceUsage(
        testPlan,
        options,
        dependencies,
        reporterDelivery
    );
    const reporterErrors = [ ...startErrors, ...executedTestPlan.reporterErrors ];

    return createRunResult(testPlan, executedTestPlan.perTest, reporterErrors, {
        resourceUsage,
        startedAtMs,
        wallClock: dependencies.wallClock
    });
}

async function executeRun(input: ExecuteRunInput): Promise<RunResult> {
    const result = await createRunResultBeforeRunEnd(
        input.testPlan,
        input.options,
        input.context.dependencies,
        input.context.reporterDelivery
    );
    const runEndErrors = await input.context.reporterDelivery.reportEvent({
        kind: 'run-end',
        result
    });
    const resultForFinalReporting = appendRunnerErrors(result, runEndErrors);
    const finalReporterErrors = await input.context.reporterDelivery.reportResult(resultForFinalReporting);
    const disposeErrors = await input.reporterDisposal.disposeOnce();

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
        const reporterDelivery = await dependencies.reporterDispatcher.createDelivery(
            executeOptions.reporters,
            executeOptions.outputRenderer
        );
        const reporterDisposal = createReporterDisposal(reporterDelivery.disposeReporters);

        try {
            return await executeRun({
                context: {
                    dependencies: executionDependencies,
                    reporterDelivery
                },
                options: executeOptions,
                reporterDisposal,
                testPlan
            });
        } catch (error: unknown) {
            return await throwWithCleanupErrors(error, reporterDisposal);
        }
    };
}
