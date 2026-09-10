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
import {
    type PerTestResult,
    type RunnerError,
    type TestContractFailure,
    type TestFailure,
    type TestOutcome,
    invalidDeepAssertionOperandFailure,
    verdictFromOutcome
} from './run-result.ts';
import { createTestScopeLifecycle } from './test-scope-lifecycle.ts';
import type { TestPlanCase } from './test-plan.ts';

type BodyErrorRecord = ThrownErrorRecord;

type ExecutedBody = {
    readonly bodyError: BodyErrorRecord | null;
    readonly cleanupErrors: readonly BodyErrorRecord[];
    readonly contractFailures: readonly TestContractFailure[];
    readonly requireFailed: boolean;
    readonly returnedAssertions: readonly AssertionNode[];
};

type ExecutedCase = {
    readonly result: PerTestResult;
    readonly wallTimeMs: number;
};

export type RunTestCaseOptions = {
    readonly controller: AbortController;
    readonly runtimePolicy: TestRuntimePolicy | null;
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

function requireFailedBody(recorder: AssertionRecorder): ExecutedBody {
    return {
        bodyError: null,
        cleanupErrors: [],
        contractFailures: [],
        requireFailed: true,
        returnedAssertions: recorder.activeRecordedAssertions()
    };
}

function contractFailedBody(
    recorder: AssertionRecorder,
    contractFailures: readonly TestContractFailure[]
): ExecutedBody {
    return {
        bodyError: null,
        cleanupErrors: [],
        contractFailures,
        requireFailed: false,
        returnedAssertions: recorder.activeRecordedAssertions()
    };
}

function bodyErrorResult(recorder: AssertionRecorder, error: unknown): ExecutedBody {
    return {
        bodyError: createThrownErrorRecord(error),
        cleanupErrors: [],
        contractFailures: [],
        requireFailed: false,
        returnedAssertions: recorder.activeRecordedAssertions()
    };
}

function completedBody(
    recorder: AssertionRecorder,
    assertionResult: AssertionResult,
    lifecycleFailures: readonly TestContractFailure[],
    cleanupErrors: readonly BodyErrorRecord[]
): ExecutedBody {
    if (recorder.requireFailed()) {
        return {
            ...requireFailedBody(recorder),
            cleanupErrors,
            contractFailures: lifecycleFailures
        };
    }

    const returnedAssertions = recorder.returnedAssertions(assertionResult);
    const returnedContractFailures = isTestContractFailure(returnedAssertions) ? [ returnedAssertions ] : [];
    const activeAssertions = isTestContractFailure(returnedAssertions)
        ? recorder.activeRecordedAssertions()
        : returnedAssertions;

    return {
        bodyError: null,
        cleanupErrors,
        contractFailures: [ ...returnedContractFailures, ...lifecycleFailures ],
        requireFailed: false,
        returnedAssertions: activeAssertions
    };
}

function failedBody(
    recorder: AssertionRecorder,
    error: unknown,
    lifecycleFailures: readonly TestContractFailure[],
    cleanupErrors: readonly BodyErrorRecord[]
): ExecutedBody {
    if (error instanceof RequireFailedSignalError) {
        return {
            ...requireFailedBody(recorder),
            cleanupErrors,
            contractFailures: lifecycleFailures
        };
    }

    return error instanceof TestContractSignalError
        ? contractFailedBody(recorder, [ error.failure(), ...lifecycleFailures ])
        : {
            ...bodyErrorResult(recorder, error),
            cleanupErrors,
            contractFailures: lifecycleFailures
        };
}

async function runCaseBody(
    testCase: TestPlanCase,
    recorder: AssertionRecorder,
    options: RunTestCaseOptions
): Promise<ExecutedBody> {
    const lifecycle = createTestScopeLifecycle(recorder);
    const runBody = async function runUserBody(): Promise<AssertionResult> {
        if (testCase.execution.kind !== 'body') {
            throw new TypeError('Skipped test cases do not have executable bodies.');
        }

        return await lifecycle.runBody(options.controller.signal, testCase.execution.body);
    };
    const runPolicyCheckedBody = async function runPolicyCheckedUserBody(): Promise<AssertionResult> {
        return options.runtimePolicy === null
            ? await runBody()
            : await options.runtimePolicy.runCase(testCase, runBody);
    };

    try {
        const assertionResult = await runPolicyCheckedBody();
        const finishedBody = await lifecycle.finish(options.controller);

        return completedBody(
            recorder,
            assertionResult,
            finishedBody.lifecycleFailures,
            finishedBody.cleanupErrors.map(createThrownErrorRecord)
        );
    } catch (error: unknown) {
        const finishedBody = await lifecycle.finish(options.controller);

        return failedBody(
            recorder,
            error,
            finishedBody.lifecycleFailures,
            finishedBody.cleanupErrors.map(createThrownErrorRecord)
        );
    }
}

function bodyFailures(executedBody: ExecutedBody): readonly TestFailure[] {
    const failures: TestFailure[] = Array.from(executedBody.contractFailures);

    if (executedBody.bodyError !== null) {
        failures.push({
            error: executedBody.bodyError,
            kind: 'body-error'
        });
    }

    for (const cleanupError of executedBody.cleanupErrors) {
        failures.push({
            error: cleanupError,
            kind: 'cleanup-error'
        });
    }

    return failures;
}

function planFailure(recorder: AssertionRecorder, executedBody: ExecutedBody): TestFailure | null {
    if (
        executedBody.requireFailed ||
        executedBody.contractFailures.length > 0 ||
        executedBody.bodyError !== null ||
        executedBody.cleanupErrors.length > 0
    ) {
        return null;
    }

    return recorder.validateAssertionCount(executedBody.returnedAssertions.length);
}

function createOutcome(recorder: AssertionRecorder, executedBody: ExecutedBody): TestOutcome {
    const failures = [
        assertionFailure(executedBody.returnedAssertions),
        ...bodyFailures(executedBody),
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
        controller,
        runtimePolicy: null
    };
}

export function timeoutFailure(deadlineMilliseconds: number, elapsedMilliseconds: number): TestFailure {
    return {
        deadlineMilliseconds,
        elapsedMilliseconds,
        kind: 'timeout'
    };
}

export function invalidTimeoutControlFailure(actual: unknown, expected: string): TestContractFailure {
    return {
        actual,
        code: 'invalid-timeout-control',
        expected,
        kind: 'test-contract',
        summary: 'Timeout control must be a positive safe integer within the profile soft timeout.'
    };
}

export async function runTestCase(
    testCase: TestPlanCase,
    wallClock: WallClock,
    options: RunTestCaseOptions = defaultRunTestCaseOptions()
): Promise<ExecutedCase> {
    const startedAt = wallClock.currentTimestampInMilliseconds;

    if (testCase.execution.kind === 'skip') {
        const outcome: TestOutcome = { kind: 'skip', reason: testCase.execution.reason };

        return {
            result: {
                id: testCase.id,
                outcome,
                verdict: verdictFromOutcome(outcome)
            },
            wallTimeMs: wallClock.currentTimestampInMilliseconds - startedAt
        };
    }

    const recorder = createAssertionRecorder();

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
