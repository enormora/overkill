import type { WallClock } from '@enormora/wall-clock';
import {
    type PerTestResult,
    type TestContractFailure,
    type TestFailure,
    type TestOutcome,
    verdictFromOutcome
} from './run-result.ts';
import type {
    AssertionNode,
    AssertionResult,
    FailedCheck,
    NonEmptyReadonlyArray,
    TestContext
} from './test-node.ts';
import type { TestPlanCase } from './test-plan.ts';

const failedOkValues = new Set<unknown>([ false, null, undefined, 0, '' ]);

type AssertionRecorder = {
    readonly appendedAssertions: () => readonly AssertionNode[];
    readonly done: () => NonEmptyReadonlyArray<AssertionNode>;
    readonly equal: (actual: unknown, expected: unknown, summary: string) => void;
    readonly ok: (actual: unknown, summary: string) => void;
    readonly plan: (count: number) => void;
    readonly requireEqual: (actual: unknown, expected: unknown, summary: string) => void;
    readonly requireOk: (actual: unknown, summary: string) => void;
    readonly validateAssertionCount: (assertionCount: number) => TestContractFailure | null;
};

type BodyErrorRecord = {
    readonly message: string;
    readonly name: string;
    readonly stack: string | null;
    readonly thrown: unknown;
};

type ExecutedBody = {
    readonly bodyError: BodyErrorRecord | null;
    readonly contractFailure: TestContractFailure | null;
    readonly requireFailed: boolean;
    readonly returnedAssertions: readonly AssertionNode[];
};

type ExecutedCase = {
    readonly result: PerTestResult;
    readonly wallTimeMs: number;
};

class RequireFailedSignalError extends Error {
    public constructor() {
        super('Requirement failed.');
        this.name = 'RequireFailedSignalError';
    }
}

class TestContractSignalError extends Error {
    private readonly contractFailure: TestContractFailure;

    public constructor(failure: TestContractFailure, options: Readonly<ErrorOptions> | undefined) {
        super(failure.summary, options);
        this.name = 'TestContractSignalError';
        this.contractFailure = failure;
    }

    public failure(): TestContractFailure {
        return this.contractFailure;
    }
}

function assertNonEmptyItems<Item>(
    items: readonly Item[],
    message: string
): asserts items is NonEmptyReadonlyArray<Item> {
    if (items.length === 0) {
        throw new TypeError(message);
    }
}

function createBodyErrorRecord(thrown: unknown): BodyErrorRecord {
    if (thrown instanceof Error) {
        return {
            message: thrown.message,
            name: thrown.name,
            stack: thrown.stack ?? null,
            thrown
        };
    }

    return {
        message: 'Test body threw a non-error value.',
        name: typeof thrown,
        stack: null,
        thrown
    };
}

function createNoAssertionsFailure(): TestContractFailure {
    return {
        actual: 0,
        code: 'no-assertions',
        expected: 'at least one assertion',
        kind: 'test-contract',
        summary: 'Expected at least one assertion.'
    };
}

function createInvalidPlanFailure(actual: unknown): TestContractFailure {
    return {
        actual,
        code: 'invalid-plan',
        expected: 'positive integer plan before assertions',
        kind: 'test-contract',
        summary: 'Assertion plan must be a positive integer before assertions.'
    };
}

function createPlanMismatchFailure(actual: number, expected: number): TestContractFailure {
    return {
        actual,
        code: 'plan-mismatch',
        expected: String(expected),
        kind: 'test-contract',
        summary: 'Assertion plan count did not match.'
    };
}

function createAssertionRecorder(): AssertionRecorder {
    const appendedAssertions: AssertionNode[] = [];
    let plannedCount: number | null = null;

    function appendAssertion(assertion: AssertionNode): void {
        appendedAssertions.push(assertion);
    }

    function ensurePlanAllowed(count: number): void {
        if (!Number.isSafeInteger(count) || count <= 0 || plannedCount !== null || appendedAssertions.length > 0) {
            throw new TestContractSignalError(createInvalidPlanFailure(count), undefined);
        }
    }

    function done(): NonEmptyReadonlyArray<AssertionNode> {
        if (appendedAssertions.length === 0) {
            throw new TestContractSignalError(createNoAssertionsFailure(), undefined);
        }

        assertNonEmptyItems(appendedAssertions, 'Expected builder assertions to be non-empty.');

        return appendedAssertions;
    }

    return {
        appendedAssertions() {
            return appendedAssertions;
        },

        done,

        equal(actual, expected, summary) {
            appendAssertion({ actual, check: 'equal', expected, summary });
        },

        ok(actual, summary) {
            appendAssertion({ actual, check: 'ok', summary });
        },

        plan(count) {
            ensurePlanAllowed(count);
            plannedCount = count;
        },

        requireEqual(actual, expected, summary) {
            appendAssertion({ actual, check: 'equal', expected, summary });
            if (!Object.is(actual, expected)) {
                throw new RequireFailedSignalError();
            }
        },

        requireOk(actual, summary) {
            appendAssertion({ actual, check: 'ok', summary });
            if (failedOkValues.has(actual)) {
                throw new RequireFailedSignalError();
            }
        },

        validateAssertionCount(assertionCount) {
            if (plannedCount !== null && plannedCount !== assertionCount) {
                return createPlanMismatchFailure(assertionCount, plannedCount);
            }

            return null;
        }
    };
}

function createFailedCheck(assertion: AssertionNode, id: number): FailedCheck | null {
    if (assertion.check === 'equal') {
        if (Object.is(assertion.actual, assertion.expected)) {
            return null;
        }

        return {
            actual: assertion.actual,
            expected: assertion.expected,
            id: String(id),
            location: { column: null, file: '', line: null },
            path: [],
            summary: assertion.summary
        };
    }

    if (!failedOkValues.has(assertion.actual)) {
        return null;
    }

    return {
        actual: assertion.actual,
        expected: true,
        id: String(id),
        location: { column: null, file: '', line: null },
        path: [],
        summary: assertion.summary
    };
}

function isAssertionNode(assertionResult: AssertionResult): assertionResult is AssertionNode {
    return !Array.isArray(assertionResult);
}

function normalizeAssertionResult(assertionResult: AssertionResult): readonly AssertionNode[] {
    return isAssertionNode(assertionResult) ? [ assertionResult ] : assertionResult;
}

function evaluatedAssertionFailure(assertions: readonly AssertionNode[]): TestFailure | null {
    const checks = assertions.flatMap(function evaluateAssertion(assertion, index) {
        const failedCheck = createFailedCheck(assertion, index + 1);

        return failedCheck === null ? [] : [ failedCheck ];
    });

    if (checks.length === 0) {
        return null;
    }

    assertNonEmptyItems(checks, 'Expected failed checks to be non-empty.');

    return {
        checks,
        kind: 'assertion'
    };
}

function createTestContext(recorder: AssertionRecorder): TestContext {
    return {
        assert: {
            done() {
                return recorder.done();
            },
            equal(actual, expected, summary) {
                recorder.equal(actual, expected, summary);
            },
            ok(actual, summary) {
                recorder.ok(actual, summary);
            }
        },
        plan(count) {
            recorder.plan(count);
        },
        require: {
            done() {
                return recorder.done();
            },
            equal(actual, expected, summary) {
                recorder.requireEqual(actual, expected, summary);
            },
            ok(actual, summary) {
                recorder.requireOk(actual, summary);
            }
        }
    };
}

async function runCaseBody(testCase: TestPlanCase, recorder: AssertionRecorder): Promise<ExecutedBody> {
    try {
        const assertionResult = await testCase.body(createTestContext(recorder));

        return {
            bodyError: null,
            contractFailure: null,
            requireFailed: false,
            returnedAssertions: normalizeAssertionResult(assertionResult)
        };
    } catch (error: unknown) {
        if (error instanceof RequireFailedSignalError) {
            return {
                bodyError: null,
                contractFailure: null,
                requireFailed: true,
                returnedAssertions: recorder.appendedAssertions()
            };
        }

        if (error instanceof TestContractSignalError) {
            return {
                bodyError: null,
                contractFailure: error.failure(),
                requireFailed: false,
                returnedAssertions: recorder.appendedAssertions()
            };
        }

        return {
            bodyError: createBodyErrorRecord(error),
            contractFailure: null,
            requireFailed: false,
            returnedAssertions: recorder.appendedAssertions()
        };
    }
}

function bodyFailure(executedBody: ExecutedBody): TestFailure | null {
    if (executedBody.contractFailure !== null) {
        return executedBody.contractFailure;
    }

    if (executedBody.bodyError !== null) {
        return {
            error: executedBody.bodyError,
            kind: 'body-error'
        };
    }

    return null;
}

function planFailure(recorder: AssertionRecorder, executedBody: ExecutedBody): TestFailure | null {
    if (executedBody.requireFailed || executedBody.contractFailure !== null || executedBody.bodyError !== null) {
        return null;
    }

    return recorder.validateAssertionCount(executedBody.returnedAssertions.length);
}

function createOutcome(recorder: AssertionRecorder, executedBody: ExecutedBody): TestOutcome {
    const failures = [
        evaluatedAssertionFailure(executedBody.returnedAssertions),
        bodyFailure(executedBody),
        planFailure(recorder, executedBody)
    ]
        .filter(function isTestFailure(failure): failure is TestFailure {
            return failure !== null;
        });

    if (failures.length === 0) {
        return { kind: 'pass' };
    }

    assertNonEmptyItems(failures, 'Expected test failures to be non-empty.');

    return {
        failures,
        kind: 'fail'
    };
}

export async function runTestCase(testCase: TestPlanCase, wallClock: WallClock): Promise<ExecutedCase> {
    const recorder = createAssertionRecorder();
    const startedAt = wallClock.currentTimestampInMilliseconds;

    const executedBody = await runCaseBody(testCase, recorder);
    const outcome = createOutcome(recorder, executedBody);
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
