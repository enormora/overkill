import type { WallClock } from '@enormora/wall-clock';
import {
    evaluateAssertion,
    invalidDeepAssertionOperand
} from '../assertion-protocol/evaluation.ts';
import type { AssertionNode, AssertionResult } from '../assertion-protocol/assertion-node.ts';
import { createThrownErrorRecord, type ThrownErrorRecord } from '../assertion-protocol/thrown-error-record.ts';
import {
    assertNonEmptyItems,
    createAssertionRecorder,
    isTestContractFailure,
    RequireFailedSignalError,
    TestContractSignalError,
    type AssertionRecorder
} from './assertion-recorder.ts';
import { createRecordingAssertFacade } from './assertion-facade.ts';
import { createRecordingRequireFacade } from './require-assertion-facade.ts';
import {
    type PerTestResult,
    type RunnerError,
    type TestContractFailure,
    type TestFailure,
    type TestOutcome,
    invalidDeepAssertionOperandFailure,
    verdictFromOutcome
} from './run-result.ts';
import type { TestScope } from './test-node.ts';
import type { TestPlanCase } from './test-plan.ts';

type BodyErrorRecord = ThrownErrorRecord;

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

export type RunTestCaseOptions = {
    readonly runtimePolicy: TestRuntimePolicy | null;
    readonly signal: AbortSignal;
};

export type TestRuntimePolicy = {
    readonly runCase: <Value>(testCase: TestPlanCase, run: () => Promise<Value>) => Promise<Value>;
    readonly runLoad: <Value>(run: () => Promise<Value>) => Promise<Value>;
    readonly takeCaseErrors: (testCase: TestPlanCase) => readonly RunnerError[];
    readonly takeRunErrors: () => readonly RunnerError[];
};

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

function assertionContractFailure(assertions: readonly AssertionNode[]): TestContractFailure | null {
    for (const assertion of assertions) {
        const invalid = invalidDeepAssertionOperand(assertion);

        if (invalid !== null) {
            return invalidDeepAssertionOperandFailure(invalid);
        }
    }

    return null;
}

function assertionFailure(assertions: readonly AssertionNode[]): TestFailure | null {
    return assertionContractFailure(assertions) ?? evaluatedAssertionFailure(assertions);
}

function createTestScope(recorder: AssertionRecorder, signal: AbortSignal): TestScope {
    const assertContext = Object.assign(
        createRecordingAssertFacade(
            {
                failContract(failure) {
                    return recorder.failContract(failure);
                },
                recordAssert(assertion) {
                    recorder.recordAssert(assertion);
                },
                recordPendingAssert() {
                    return recorder.recordPendingAssert();
                }
            },
            null
        ),
        {
            collect() {
                return recorder.collect();
            }
        }
    );

    return {
        assert: assertContext,
        plan(count) {
            recorder.plan(count);
        },
        require: createRecordingRequireFacade(
            {
                failContract(failure) {
                    return recorder.failContract(failure);
                },
                recordRequire(assertion) {
                    recorder.recordRequire(assertion);
                }
            },
            null
        ),
        signal
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
        bodyError: createThrownErrorRecord(error),
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

async function runCaseBody(
    testCase: TestPlanCase,
    recorder: AssertionRecorder,
    options: RunTestCaseOptions
): Promise<ExecutedBody> {
    try {
        const runBody = async function runUserBody() {
            return await testCase.body(createTestScope(recorder, options.signal));
        };
        const assertionResult = options.runtimePolicy === null
            ? await runBody()
            : await options.runtimePolicy.runCase(testCase, runBody);

        return completedBody(recorder, assertionResult);
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
        assertionFailure(executedBody.returnedAssertions),
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

function defaultRunTestCaseOptions(): RunTestCaseOptions {
    const controller = new AbortController();

    return {
        runtimePolicy: null,
        signal: controller.signal
    };
}

export function timeoutFailure(deadlineMilliseconds: number, elapsedMilliseconds: number): TestFailure {
    return {
        deadlineMilliseconds,
        elapsedMilliseconds,
        kind: 'timeout'
    };
}

export function invalidTimeoutMetadataFailure(actual: unknown, expected: string): TestContractFailure {
    return {
        actual,
        code: 'invalid-timeout-metadata',
        expected,
        kind: 'test-contract',
        summary: 'Timeout metadata must be a positive safe integer within the hard timeout.'
    };
}

export async function runTestCase(
    testCase: TestPlanCase,
    wallClock: WallClock,
    options: RunTestCaseOptions = defaultRunTestCaseOptions()
): Promise<ExecutedCase> {
    const recorder = createAssertionRecorder();
    const startedAt = wallClock.currentTimestampInMilliseconds;

    const executedBody = await runCaseBody(testCase, recorder, options);
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
