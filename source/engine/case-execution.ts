import type { WallClock } from '@enormora/wall-clock';
import { assertionPasses, evaluateAssertion } from '../assertion-protocol/evaluation.ts';
import type {
    AssertAssertionNode,
    AssertionNode,
    AssertionResult,
    RequireAssertionNode
} from '../assertion-protocol/assertion-node.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { createRecordingAssertFacade, createRecordingRequireFacade } from './assertion-facade.ts';
import {
    type PerTestResult,
    type TestContractFailure,
    type TestFailure,
    type TestOutcome,
    verdictFromOutcome
} from './run-result.ts';
import type { TestContext } from './test-node.ts';
import type { TestPlanCase } from './test-plan.ts';

type RecordedAssertion = {
    readonly assertion: AssertionNode;
    readonly builderAssertion: AssertAssertionNode | null;
};

type RecordedRequireMergeStep = {
    readonly assertions: readonly AssertionNode[];
    readonly recordIndex: number;
};

type AssertionRecorder = {
    readonly activeRecordedAssertions: () => readonly AssertionNode[];
    readonly done: () => NonEmptyReadonlyArray<AssertAssertionNode>;
    readonly plan: (count: number) => void;
    readonly recordAssert: (assertion: AssertAssertionNode) => void;
    readonly recordRequire: (assertion: RequireAssertionNode) => void;
    readonly requireFailed: () => boolean;
    readonly returnedAssertions: (assertionResult: AssertionResult) => TestContractFailure | readonly AssertionNode[];
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

function createDeadBuilderAssertionFailure(): TestContractFailure {
    return {
        actual: 'missing recorded builder assertion',
        code: 'dead-builder-assertion',
        expected: 'returned assertions include every recorded builder assertion',
        kind: 'test-contract',
        summary: 'Returned assertions must include every recorded builder assertion.'
    };
}

function isTestContractFailure(value: TestContractFailure | readonly AssertionNode[]): value is TestContractFailure {
    return !Array.isArray(value);
}

function isAssertionNode(assertionResult: AssertionResult): assertionResult is AssertAssertionNode {
    return !Array.isArray(assertionResult);
}

function normalizeAssertionResult(assertionResult: AssertionResult): NonEmptyReadonlyArray<AssertAssertionNode> {
    const assertions = isAssertionNode(assertionResult) ? [ assertionResult ] : assertionResult;

    assertNonEmptyItems(assertions, 'Expected returned assertions to be non-empty.');

    return assertions;
}

function builderAssertionsInReturnedOrder(
    builderAssertions: readonly AssertAssertionNode[],
    returnedAssertions: readonly AssertAssertionNode[]
): boolean {
    let returnedIndex = 0;

    return builderAssertions.every(function builderAssertionReturned(builderAssertion) {
        while (returnedIndex < returnedAssertions.length) {
            const returnedAssertion = returnedAssertions[returnedIndex];
            returnedIndex += 1;

            if (returnedAssertion === builderAssertion) {
                return true;
            }
        }

        return false;
    });
}

function appendRecordedRequiresBeforeBuilderAssertion(
    recordedAssertions: readonly RecordedAssertion[],
    recordIndex: number,
    builderAssertion: AssertAssertionNode
): RecordedRequireMergeStep {
    let nextRecordIndex = recordIndex;
    const assertions: AssertionNode[] = [];

    while (nextRecordIndex < recordedAssertions.length) {
        const recorded = recordedAssertions[nextRecordIndex];

        if (recorded?.builderAssertion === builderAssertion) {
            return { assertions, recordIndex: nextRecordIndex + 1 };
        }

        if (recorded?.assertion.source === 'require') {
            assertions.push(recorded.assertion);
        }

        nextRecordIndex += 1;
    }

    return { assertions, recordIndex: nextRecordIndex };
}

function appendRemainingRecordedRequires(
    recordedAssertions: readonly RecordedAssertion[],
    recordIndex: number
): readonly AssertionNode[] {
    const assertions: AssertionNode[] = [];

    for (const recorded of recordedAssertions.slice(recordIndex)) {
        if (recorded.assertion.source === 'require') {
            assertions.push(recorded.assertion);
        }
    }

    return assertions;
}

function mergeRecordedRequires(
    recordedAssertions: readonly RecordedAssertion[],
    returnedAssertions: readonly AssertAssertionNode[]
): readonly AssertionNode[] {
    const mergedAssertions: AssertionNode[] = [];
    let recordIndex = 0;

    for (const returnedAssertion of returnedAssertions) {
        const step = appendRecordedRequiresBeforeBuilderAssertion(
            recordedAssertions,
            recordIndex,
            returnedAssertion
        );
        recordIndex = step.recordIndex;
        mergedAssertions.push(...step.assertions, returnedAssertion);
    }

    mergedAssertions.push(...appendRemainingRecordedRequires(recordedAssertions, recordIndex));

    return mergedAssertions;
}

function createAssertionRecorder(): AssertionRecorder {
    const builderAssertions: AssertAssertionNode[] = [];
    const recordedAssertions: RecordedAssertion[] = [];
    let failedRequireIndex: number | null = null;
    let plannedCount: number | null = null;

    function activeRecords(): readonly RecordedAssertion[] {
        if (failedRequireIndex === null) {
            return recordedAssertions;
        }

        return recordedAssertions.slice(0, failedRequireIndex + 1);
    }

    function assertionCount(): number {
        return recordedAssertions.length;
    }

    function ensurePlanAllowed(count: number): void {
        if (!Number.isSafeInteger(count) || count <= 0 || plannedCount !== null || assertionCount() > 0) {
            throw new TestContractSignalError(createInvalidPlanFailure(count), undefined);
        }
    }

    function done(): NonEmptyReadonlyArray<AssertAssertionNode> {
        if (builderAssertions.length === 0) {
            throw new TestContractSignalError(createNoAssertionsFailure(), undefined);
        }

        assertNonEmptyItems(builderAssertions, 'Expected builder assertions to be non-empty.');

        return builderAssertions;
    }

    function validateReturnedAssertions(assertions: readonly AssertAssertionNode[]): TestContractFailure | null {
        if (!builderAssertionsInReturnedOrder(builderAssertions, assertions)) {
            return createDeadBuilderAssertionFailure();
        }

        return null;
    }

    return {
        activeRecordedAssertions() {
            return activeRecords().map(function toAssertion(recorded) {
                return recorded.assertion;
            });
        },

        done,

        plan(count) {
            ensurePlanAllowed(count);
            plannedCount = count;
        },

        recordAssert(assertion) {
            builderAssertions.push(assertion);
            recordedAssertions.push({ assertion, builderAssertion: assertion });
        },

        recordRequire(assertion) {
            recordedAssertions.push({ assertion, builderAssertion: null });

            if (!assertionPasses(assertion)) {
                failedRequireIndex = recordedAssertions.length - 1;
                throw new RequireFailedSignalError();
            }
        },

        requireFailed() {
            return failedRequireIndex !== null;
        },

        returnedAssertions(assertionResult) {
            const assertions = normalizeAssertionResult(assertionResult);
            const contractFailure = validateReturnedAssertions(assertions);

            if (contractFailure !== null) {
                return contractFailure;
            }

            return mergeRecordedRequires(activeRecords(), assertions);
        },

        validateAssertionCount(reachedAssertionCount) {
            if (plannedCount !== null && plannedCount !== reachedAssertionCount) {
                return createPlanMismatchFailure(reachedAssertionCount, plannedCount);
            }

            return null;
        }
    };
}

function evaluatedAssertionFailure(assertions: readonly AssertionNode[]): TestFailure | null {
    const checks = assertions.flatMap(function evaluateRecordedAssertion(assertion, index) {
        const failedCheck = evaluateAssertion(assertion, index + 1);

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
            ...createRecordingAssertFacade(
                function recordAssert(assertion) {
                    recorder.recordAssert(assertion);
                },
                null
            ),
            done() {
                return recorder.done();
            }
        },
        plan(count) {
            recorder.plan(count);
        },
        require: createRecordingRequireFacade(
            function recordRequire(assertion) {
                recorder.recordRequire(assertion);
            },
            null
        )
    };
}

function requireFailedBody(recorder: AssertionRecorder): ExecutedBody {
    return {
        bodyError: null,
        contractFailure: null,
        requireFailed: true,
        returnedAssertions: recorder.activeRecordedAssertions()
    };
}

function contractFailedBody(recorder: AssertionRecorder, contractFailure: TestContractFailure): ExecutedBody {
    return {
        bodyError: null,
        contractFailure,
        requireFailed: false,
        returnedAssertions: recorder.activeRecordedAssertions()
    };
}

function bodyErrorResult(recorder: AssertionRecorder, error: unknown): ExecutedBody {
    return {
        bodyError: createBodyErrorRecord(error),
        contractFailure: null,
        requireFailed: false,
        returnedAssertions: recorder.activeRecordedAssertions()
    };
}

function completedBody(recorder: AssertionRecorder, assertionResult: AssertionResult): ExecutedBody {
    if (recorder.requireFailed()) {
        return requireFailedBody(recorder);
    }

    const returnedAssertions = recorder.returnedAssertions(assertionResult);

    return isTestContractFailure(returnedAssertions)
        ? contractFailedBody(recorder, returnedAssertions)
        : {
            bodyError: null,
            contractFailure: null,
            requireFailed: false,
            returnedAssertions
        };
}

function failedBody(recorder: AssertionRecorder, error: unknown): ExecutedBody {
    if (error instanceof RequireFailedSignalError) {
        return requireFailedBody(recorder);
    }

    return error instanceof TestContractSignalError
        ? contractFailedBody(recorder, error.failure())
        : bodyErrorResult(recorder, error);
}

async function runCaseBody(testCase: TestPlanCase, recorder: AssertionRecorder): Promise<ExecutedBody> {
    try {
        return completedBody(recorder, await testCase.body(createTestContext(recorder)));
    } catch (error: unknown) {
        return failedBody(recorder, error);
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
