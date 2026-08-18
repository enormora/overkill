import type { WallClock } from '@enormora/wall-clock';
import { runTestCase } from './case-execution.ts';
import { caseIdentityKey } from './identity.ts';
import { createPlainOutputRenderer, type OutputRenderer } from './reporter-output.ts';
import type { ReporterDispatcher } from './reporter-dispatcher.ts';
import { type Reporter, type RunFacts, validateReporterSinks } from './reporter.ts';
import { createReporterEventQueue, type ReporterEventQueue } from './reporter-event-queue.ts';
import { verdictFromOutcome, type PerTestResult, type RunResult, type RunnerError } from './run-result.ts';
import type { TestPlan, TestPlanCase } from './test-plan.ts';

export type ExecuteExecution = {
    readonly mode: 'concurrent-in-process' | 'serial-in-process';
};

export type ExecuteOptions = {
    readonly execution: ExecuteExecution;
    readonly outputRenderer?: OutputRenderer;
    readonly reporters: readonly Reporter[];
    readonly runFacts: RunFacts;
    readonly startedAt: string;
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

type ReportedCase = {
    readonly reporterErrors: readonly RunnerError[];
    readonly result: PerTestResult;
};

type ConcurrentCase = {
    readonly result: PerTestResult;
    readonly wallTimeMs: number;
};

type ConcurrentCaseExecution = {
    readonly endReporterErrors: readonly RunnerError[];
    readonly perTest: readonly PerTestResult[];
};

type ReportTestEndInput = {
    readonly attempt: number;
    readonly result: PerTestResult;
    readonly testCase: TestPlanCase;
    readonly wallTimeMs: number;
};

type RunResultTiming = {
    readonly startedAtMs: number;
    readonly wallClock: WallClock;
};

type ExecutionDependencies = {
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

async function executeCase(
    testCase: TestPlanCase,
    attempt: number,
    context: ExecutionReportingContext
): Promise<ReportedCase> {
    const startErrors = await reportTestStart(testCase, attempt, context);
    const executedCase = await runTestCase(testCase, context.dependencies.wallClock);
    const endErrors = await reportTestEnd(
        {
            attempt,
            result: executedCase.result,
            testCase,
            wallTimeMs: executedCase.wallTimeMs
        },
        context
    );

    return {
        reporterErrors: [ ...startErrors, ...endErrors ],
        result: executedCase.result
    };
}

function hasFailed(testResult: PerTestResult): boolean {
    return testResult.outcome.kind === 'fail';
}

function isInconclusive(testResult: PerTestResult): boolean {
    return testResult.outcome.kind === 'inconclusive';
}

function hasPassed(testResult: PerTestResult): boolean {
    return testResult.outcome.kind === 'pass';
}

function wasSkipped(testResult: PerTestResult): boolean {
    return testResult.outcome.kind === 'skip';
}

function countOutcomes(testPlan: TestPlan, perTest: readonly PerTestResult[]): RunResult['summary'] {
    return {
        defined: testPlan.defined,
        discovered: testPlan.discoveredCases.length,
        failed: perTest.filter(hasFailed).length,
        inconclusive: perTest.filter(isInconclusive).length,
        passed: perTest.filter(hasPassed).length,
        planned: testPlan.cases.length,
        skipped: perTest.filter(wasSkipped).length
    };
}

function suiteKey(suitePath: readonly string[]): string {
    return suitePath.join(' > ');
}

function emptySuiteRunCounts(): RunResult['bySuite'][string] {
    return { discovered: 0, executed: 0, planned: 0 };
}

function incrementSuiteRunCounts(
    counts: RunResult['bySuite'][string],
    field: 'discovered' | 'executed' | 'planned'
): RunResult['bySuite'][string] {
    return {
        discovered: counts.discovered + (field === 'discovered' ? 1 : 0),
        executed: counts.executed + (field === 'executed' ? 1 : 0),
        planned: counts.planned + (field === 'planned' ? 1 : 0)
    };
}

function countSuitePath(
    counts: RunResult['bySuite'],
    suitePath: readonly string[],
    field: 'discovered' | 'executed' | 'planned'
): RunResult['bySuite'] {
    let updatedCounts = counts;

    for (let pathLength = 1; pathLength <= suitePath.length; pathLength += 1) {
        const key = suiteKey(suitePath.slice(0, pathLength));
        updatedCounts = {
            ...updatedCounts,
            [key]: incrementSuiteRunCounts(updatedCounts[key] ?? emptySuiteRunCounts(), field)
        };
    }

    return updatedCounts;
}

function countSuites(testPlan: TestPlan, perTest: readonly PerTestResult[]): RunResult['bySuite'] {
    let counts: RunResult['bySuite'] = {};
    const executedIds = new Set(
        perTest.map(function toId(result) {
            return caseIdentityKey(result.id);
        })
    );

    for (const testCase of testPlan.discoveredCases) {
        counts = countSuitePath(counts, testCase.suitePath, 'discovered');
    }

    for (const testCase of testPlan.cases) {
        counts = countSuitePath(counts, testCase.suitePath, 'planned');

        if (executedIds.has(caseIdentityKey(testCase.id))) {
            counts = countSuitePath(counts, testCase.suitePath, 'executed');
        }
    }

    return counts;
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
    reporters: readonly Reporter[],
    outputRenderer: OutputRenderer,
    dependencies: ExecutionDependencies
): Promise<ExecutedTestPlan> {
    let perTest: readonly PerTestResult[] = [];
    let reporterErrors: readonly RunnerError[] = [];
    let currentSuitePath: readonly string[] = [];

    for (const testCase of testPlan.cases) {
        const suiteErrors = await reportSuiteTransition(
            { dependencies, outputRenderer, reporters },
            currentSuitePath,
            testCase.suitePath
        );
        currentSuitePath = testCase.suitePath;

        const testRun = await executeCase(testCase, 0, { dependencies, outputRenderer, reporters });
        reporterErrors = [ ...reporterErrors, ...suiteErrors, ...testRun.reporterErrors ];
        perTest = [ ...perTest, testRun.result ];
    }

    return {
        perTest,
        reporterErrors: [
            ...reporterErrors,
            ...await reportSuiteTransition({ dependencies, outputRenderer, reporters }, currentSuitePath, [])
        ]
    };
}

function describeUnexpectedCaseError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return 'Unknown test execution error.';
}

function createInconclusiveCaseResult(testCase: TestPlanCase, error: unknown): PerTestResult {
    const outcome = {
        kind: 'inconclusive',
        reason: `Test execution failed before producing a result: ${describeUnexpectedCaseError(error)}`
    } as const;

    return {
        id: testCase.id,
        outcome,
        verdict: verdictFromOutcome(outcome)
    };
}

async function executeConcurrentCaseBody(
    testCase: TestPlanCase,
    dependencies: ExecutionDependencies
): Promise<ConcurrentCase> {
    try {
        const executedCase = await runTestCase(testCase, dependencies.wallClock);

        return {
            result: executedCase.result,
            wallTimeMs: executedCase.wallTimeMs
        };
    } catch (error: unknown) {
        return {
            result: createInconclusiveCaseResult(testCase, error),
            wallTimeMs: 0
        };
    }
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

async function executeConcurrentCases(
    testPlan: TestPlan,
    reportQueue: ReporterEventQueue,
    dependencies: ExecutionDependencies
): Promise<ConcurrentCaseExecution> {
    const endReporterErrors: RunnerError[] = [];
    const caseExecutions = testPlan.cases.map(async function executeCaseConcurrently(testCase) {
        const executedCase = await executeConcurrentCaseBody(testCase, dependencies);
        endReporterErrors.push(...await reportConcurrentCaseEnd(testCase, executedCase, reportQueue));

        return executedCase;
    });
    const executedCases = await Promise.all(caseExecutions);

    return {
        endReporterErrors,
        perTest: executedCases.map(function toPerTest(executedCase) {
            return executedCase.result;
        })
    };
}

async function executeConcurrentTestPlanCases(
    testPlan: TestPlan,
    reporters: readonly Reporter[],
    outputRenderer: OutputRenderer,
    dependencies: ExecutionDependencies
): Promise<ExecutedTestPlan> {
    const reporterErrors = await reportConcurrentCaseStarts(testPlan, reporters, outputRenderer, dependencies);
    const concurrentCaseExecution = await executeConcurrentCases(
        testPlan,
        createReporterEventQueue(reporters, outputRenderer, dependencies),
        dependencies
    );

    return {
        perTest: concurrentCaseExecution.perTest,
        reporterErrors: [ ...reporterErrors, ...concurrentCaseExecution.endReporterErrors ]
    };
}

async function executeTestPlanCasesWithMode(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecutionDependencies
): Promise<ExecutedTestPlan> {
    if (options.execution.mode === 'concurrent-in-process') {
        return await executeConcurrentTestPlanCases(
            testPlan,
            options.reporters,
            options.outputRenderer,
            dependencies
        );
    }

    return await executeTestPlanCases(testPlan, options.reporters, options.outputRenderer, dependencies);
}

function createRunResult(
    testPlan: TestPlan,
    perTest: readonly PerTestResult[],
    reporterErrors: readonly RunnerError[],
    timing: RunResultTiming
): RunResult {
    const result: RunResult = {
        artifacts: [],
        bySuite: countSuites(testPlan, perTest),
        orphans: testPlan.orphans,
        perTest,
        runnerErrors: reporterErrors,
        summary: countOutcomes(testPlan, perTest),
        wallTimeMs: timing.wallClock.currentTimestampInMilliseconds - timing.startedAtMs
    };

    return result;
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
            outputRenderer: options.outputRenderer ?? createPlainOutputRenderer()
        };
    }

    return {
        execution: { mode: 'serial-in-process' },
        outputRenderer: createPlainOutputRenderer(),
        reporters: [],
        runFacts: {},
        startedAt: epoch.toISOString()
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
    dependencies: ExecuteDependencies
): Promise<RunResult> {
    const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;
    const startErrors = await dependencies.reporterDispatcher.reportEvent(options.reporters, {
        facts: options.runFacts,
        kind: 'run-start',
        root: testPlan.root,
        startedAt: options.startedAt
    }, options.outputRenderer);
    const executedTestPlan = await executeTestPlanCasesWithMode(testPlan, options, dependencies);
    const reporterErrors = [ ...startErrors, ...executedTestPlan.reporterErrors ];

    return createRunResult(testPlan, executedTestPlan.perTest, reporterErrors, {
        startedAtMs,
        wallClock: dependencies.wallClock
    });
}

async function executeRun(
    testPlan: TestPlan,
    options: NormalizedExecuteOptions,
    dependencies: ExecuteDependencies,
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
        const reporterDisposal = createReporterDisposal(executeOptions.reporters, dependencies);

        try {
            return await executeRun(testPlan, executeOptions, dependencies, reporterDisposal);
        } catch (error: unknown) {
            return await throwWithCleanupErrors(error, reporterDisposal);
        }
    };
}
