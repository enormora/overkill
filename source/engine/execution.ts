import { type PerTestResult, type RunResult, type TestOutcome, verdictFromOutcome } from './run-result.ts';
import { createTestCompletion, type FailedCheck, type TestCompletion, type TestContext } from './test-node.ts';
import type { TestPlan, TestPlanCase } from './test-plan.ts';

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
        return { checks: [], kind: 'pass', reason: null };
    }

    return { checks: failedChecks, kind: 'fail', reason: null };
}

async function executeCase(testCase: TestPlanCase): Promise<PerTestResult> {
    const recorder = createAssertionRecorder();

    await runCaseBody(testCase, recorder);
    recorder.validateAssertionCount();

    const outcome = createOutcome(recorder);
    const verdict = verdictFromOutcome(outcome);

    return {
        id: testCase.id,
        outcome,
        verdict
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

function countOutcomes(perTest: readonly PerTestResult[]): RunResult['summary'] {
    return {
        defined: perTest.length,
        discovered: perTest.length,
        failed: perTest.filter(hasFailed).length,
        inconclusive: perTest.filter(isInconclusive).length,
        passed: perTest.filter(hasPassed).length,
        skipped: perTest.filter(wasSkipped).length
    };
}

function suiteKey(suitePath: readonly string[]): string {
    return suitePath.join(' > ');
}

function countSuites(cases: readonly TestPlanCase[], perTest: readonly PerTestResult[]): RunResult['bySuite'] {
    const counts: Record<string, { readonly discovered: number; readonly executed: number; }> = {};
    const executedIds = new Set(
        perTest.map(function toId(result) {
            return result.id;
        })
    );

    for (const testCase of cases) {
        const key = suiteKey(testCase.suitePath);
        const current = counts[key] ?? { discovered: 0, executed: 0 };
        counts[key] = {
            discovered: current.discovered + 1,
            executed: current.executed + (executedIds.has(testCase.id) ? 1 : 0)
        };
    }

    return counts;
}

export async function execute(testPlan: TestPlan): Promise<RunResult> {
    const startedAtMs = performance.now();
    const perTest: PerTestResult[] = [];

    for (const testCase of testPlan.cases) {
        perTest.push(await executeCase(testCase));
    }

    const result: RunResult = {
        artifacts: [],
        bySuite: countSuites(testPlan.cases, perTest),
        orphans: [],
        perTest,
        runnerErrors: [],
        summary: countOutcomes(perTest),
        wallTimeMs: performance.now() - startedAtMs
    };

    return result;
}
