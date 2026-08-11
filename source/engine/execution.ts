import type { WallClock } from '@enormora/wall-clock';
import { runTestCase } from './case-execution.ts';
import { caseIdentityKey } from './identity.ts';
import {
    type Reporter,
    type ReporterDispatcher,
    type RunFacts,
    validateReporterSinks
} from './reporter.ts';
import type { PerTestResult, RunResult, RunnerError } from './run-result.ts';
import type { TestPlan, TestPlanCase } from './test-plan.ts';

export type ExecuteOptions = {
    readonly reporters: readonly Reporter[];
    readonly runFacts: RunFacts;
    readonly startedAt: string;
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

async function executeCase(
    testCase: TestPlanCase,
    attempt: number,
    reporters: readonly Reporter[],
    dependencies: ExecutionDependencies
): Promise<ReportedCase> {
    const startErrors = await dependencies.reporterDispatcher.reportEvent(reporters, {
        attempt,
        case: testCase.id,
        kind: 'test-start'
    });
    const executedCase = await runTestCase(testCase, dependencies.wallClock);
    const endErrors = await dependencies.reporterDispatcher.reportEvent(reporters, {
        attempt,
        case: testCase.id,
        kind: 'test-end',
        outcome: executedCase.result.outcome,
        verdict: executedCase.result.verdict,
        wallTimeMs: executedCase.wallTimeMs
    });

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
    reporters: readonly Reporter[],
    dependencies: ExecutionDependencies,
    currentSuitePath: readonly string[],
    nextSuitePath: readonly string[]
): Promise<readonly RunnerError[]> {
    let reporterErrors: readonly RunnerError[] = [];
    const sharedPrefixLength = commonSuitePrefixLength(currentSuitePath, nextSuitePath);

    for (let pathLength = currentSuitePath.length; pathLength > sharedPrefixLength; pathLength -= 1) {
        reporterErrors = [
            ...reporterErrors,
            ...await dependencies.reporterDispatcher.reportEvent(reporters, {
                kind: 'suite-end',
                suitePath: currentSuitePath.slice(0, pathLength)
            })
        ];
    }

    for (let pathLength = sharedPrefixLength + 1; pathLength <= nextSuitePath.length; pathLength += 1) {
        reporterErrors = [
            ...reporterErrors,
            ...await dependencies.reporterDispatcher.reportEvent(reporters, {
                kind: 'suite-start',
                suitePath: nextSuitePath.slice(0, pathLength)
            })
        ];
    }

    return reporterErrors;
}

async function executeTestPlanCases(
    testPlan: TestPlan,
    reporters: readonly Reporter[],
    dependencies: ExecutionDependencies
): Promise<ExecutedTestPlan> {
    let perTest: readonly PerTestResult[] = [];
    let reporterErrors: readonly RunnerError[] = [];
    let currentSuitePath: readonly string[] = [];

    for (const testCase of testPlan.cases) {
        const suiteErrors = await reportSuiteTransition(
            reporters,
            dependencies,
            currentSuitePath,
            testCase.suitePath
        );
        currentSuitePath = testCase.suitePath;

        const testRun = await executeCase(testCase, 0, reporters, dependencies);
        reporterErrors = [ ...reporterErrors, ...suiteErrors, ...testRun.reporterErrors ];
        perTest = [ ...perTest, testRun.result ];
    }

    return {
        perTest,
        reporterErrors: [
            ...reporterErrors,
            ...await reportSuiteTransition(reporters, dependencies, currentSuitePath, [])
        ]
    };
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

function executeOptionsWithDefaults(options: ExecuteOptions | undefined): ExecuteOptions {
    return options ?? {
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
    options: ExecuteOptions,
    dependencies: ExecuteDependencies
): Promise<RunResult> {
    const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;
    const startErrors = await dependencies.reporterDispatcher.reportEvent(options.reporters, {
        facts: options.runFacts,
        kind: 'run-start',
        root: testPlan.root,
        startedAt: options.startedAt
    });
    const executedTestPlan = await executeTestPlanCases(testPlan, options.reporters, dependencies);
    const reporterErrors = [ ...startErrors, ...executedTestPlan.reporterErrors ];

    return createRunResult(testPlan, executedTestPlan.perTest, reporterErrors, {
        startedAtMs,
        wallClock: dependencies.wallClock
    });
}

async function executeRun(
    testPlan: TestPlan,
    options: ExecuteOptions,
    dependencies: ExecuteDependencies,
    reporterDisposal: ReporterDisposal
): Promise<RunResult> {
    validateReporterSinks(options.reporters);

    const result = await createRunResultBeforeRunEnd(testPlan, options, dependencies);
    const runEndErrors = await dependencies.reporterDispatcher.reportEvent(options.reporters, {
        kind: 'run-end',
        result
    });
    const resultForFinalReporting = appendRunnerErrors(result, runEndErrors);
    const finalReporterErrors = await dependencies.reporterDispatcher.reportResult(
        options.reporters,
        resultForFinalReporting
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
