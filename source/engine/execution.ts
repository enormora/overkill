import type { WallClock } from '@enormora/wall-clock';
import { caseIdentityKey } from './identity.ts';
import {
    type Reporter,
    type ReporterDispatcher,
    type RunFacts,
    validateReporterSinks
} from './reporter.ts';
import {
    type PerTestResult,
    type RunResult,
    type RunnerError,
    type TestOutcome,
    verdictFromOutcome
} from './run-result.ts';
import { createTestCompletion, type FailedCheck, type TestCompletion, type TestContext } from './test-node.ts';
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

const failedOkValues = new Set<unknown>([ false, null, undefined, 0, '' ]);

type AssertionRecorder = {
    readonly done: () => TestCompletion;
    readonly equal: (actual: unknown, expected: unknown, summary: string) => TestCompletion;
    readonly failedChecks: () => readonly FailedCheck[];
    readonly ok: (actual: unknown, summary: string) => TestCompletion;
    readonly plan: (count: number) => TestCompletion;
    readonly recordBodyError: (error: unknown) => void;
    readonly requireEqual: (actual: unknown, expected: unknown, summary: string) => TestCompletion;
    readonly requireOk: (actual: unknown, summary: string) => TestCompletion;
    readonly validateAssertionCount: () => void;
};

function createAssertionRecorder(): AssertionRecorder {
    const failedChecks: FailedCheck[] = [];
    let nextCheckId = 0;
    let plannedCount: number | null = null;
    let recordedCount = 0;

    function recordFailure(summary: string, expected: unknown, actual: unknown): void {
        nextCheckId += 1;
        failedChecks.push({
            actual,
            expected,
            id: String(nextCheckId),
            location: { column: null, file: '', line: null },
            path: [],
            summary
        });
    }

    function recordAssertion(): void {
        recordedCount += 1;
    }

    return {
        done: createTestCompletion,

        equal(actual, expected, summary) {
            recordAssertion();
            if (!Object.is(actual, expected)) {
                recordFailure(summary, expected, actual);
            }

            return createTestCompletion();
        },

        failedChecks() {
            return failedChecks;
        },

        ok(actual, summary) {
            recordAssertion();
            if (failedOkValues.has(actual)) {
                recordFailure(summary, true, actual);
            }

            return createTestCompletion();
        },

        plan(count) {
            plannedCount = count;
            return createTestCompletion();
        },

        recordBodyError(error) {
            recordFailure(
                error instanceof Error ? error.message : 'Test body threw a non-error value.',
                'no thrown error',
                error
            );
        },

        requireEqual(actual, expected, summary) {
            recordAssertion();
            if (!Object.is(actual, expected)) {
                recordFailure(summary, expected, actual);
                throw new Error(summary);
            }

            return createTestCompletion();
        },

        requireOk(actual, summary) {
            recordAssertion();
            if (failedOkValues.has(actual)) {
                recordFailure(summary, true, actual);
                throw new Error(summary);
            }

            return createTestCompletion();
        },

        validateAssertionCount() {
            if (recordedCount === 0) {
                recordFailure('Expected at least one assertion.', 'at least one assertion', 0);
            }

            if (plannedCount !== null && plannedCount !== recordedCount) {
                recordFailure('Assertion plan count did not match.', plannedCount, recordedCount);
            }
        }
    };
}

function createTestContext(recorder: AssertionRecorder): TestContext {
    return {
        assert: {
            done() {
                return recorder.done();
            },
            equal(actual, expected, summary) {
                return recorder.equal(actual, expected, summary);
            },
            ok(actual, summary) {
                return recorder.ok(actual, summary);
            }
        },
        plan(count) {
            return recorder.plan(count);
        },
        require: {
            done() {
                return recorder.done();
            },
            equal(actual, expected, summary) {
                return recorder.requireEqual(actual, expected, summary);
            },
            ok(actual, summary) {
                return recorder.requireOk(actual, summary);
            }
        }
    };
}

async function runCaseBody(testCase: TestPlanCase, recorder: AssertionRecorder): Promise<void> {
    try {
        await testCase.body(createTestContext(recorder));
    } catch (error: unknown) {
        recorder.recordBodyError(error);
    }
}

function createOutcome(recorder: AssertionRecorder): TestOutcome {
    const failedChecks = recorder.failedChecks();

    if (failedChecks.length === 0) {
        return { kind: 'pass' };
    }

    return { checks: failedChecks, kind: 'fail' };
}

type ExecutedCase = {
    readonly result: PerTestResult;
    readonly wallTimeMs: number;
};

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

async function runTestCase(testCase: TestPlanCase, wallClock: WallClock): Promise<ExecutedCase> {
    const recorder = createAssertionRecorder();
    const startedAt = wallClock.currentTimestampInMilliseconds;

    await runCaseBody(testCase, recorder);
    recorder.validateAssertionCount();

    const outcome = createOutcome(recorder);
    const verdict = verdictFromOutcome(outcome);

    return {
        result: {
            id: testCase.id,
            outcome,
            verdict
        },
        wallTimeMs: wallClock.currentTimestampInMilliseconds - startedAt
    };
}

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

export type Execute = (testPlan: TestPlan, options?: ExecuteOptions) => Promise<RunResult>;

export function createExecute(dependencies: ExecuteDependencies): Execute {
    return async function execute(testPlan, options) {
        const executeOptions = options ?? {
            reporters: [],
            runFacts: {},
            startedAt: epoch.toISOString()
        };
        validateReporterSinks(executeOptions.reporters);

        const startedAtMs = dependencies.wallClock.currentTimestampInMilliseconds;
        const startErrors = await dependencies.reporterDispatcher.reportEvent(executeOptions.reporters, {
            facts: executeOptions.runFacts,
            kind: 'run-start',
            startedAt: executeOptions.startedAt
        });
        const executedTestPlan = await executeTestPlanCases(testPlan, executeOptions.reporters, dependencies);
        const reporterErrors = [ ...startErrors, ...executedTestPlan.reporterErrors ];
        const result = createRunResult(testPlan, executedTestPlan.perTest, reporterErrors, {
            startedAtMs,
            wallClock: dependencies.wallClock
        });

        await dependencies.reporterDispatcher.reportEvent(executeOptions.reporters, {
            kind: 'run-end',
            result
        });
        await dependencies.reporterDispatcher.reportResult(executeOptions.reporters, result);

        return result;
    };
}
