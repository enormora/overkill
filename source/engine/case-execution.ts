import type { OverkillClock } from '../clock/overkill-clock.ts';
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
import { isNodeAssertionError, nodeAssertionErrorFailure } from './node-assertion-error.ts';
import {
    isCaseRunnerError,
    type PerTestResult,
    type RunnerError,
    type TestContractFailure,
    type TestFailure,
    type TestOutcome,
    invalidDeepAssertionOperandFailure,
    verdictFromOutcome
} from './run-result.ts';
import { createTestScopeLifecycle } from './test-scope-lifecycle.ts';
import { createThrowingTestScope } from './throwing-test-scope.ts';
import type { TestPlanCase } from './test-plan.ts';

type BodyErrorRecord = ThrownErrorRecord;

type ExecutedBody = {
    readonly bodyError: BodyErrorRecord | null;
    readonly cleanupErrors: readonly BodyErrorRecord[];
    readonly contractFailures: readonly TestContractFailure[];
    readonly requireFailed: boolean;
    readonly runnerErrors: readonly RunnerError[];
    readonly returnedAssertions: readonly AssertionNode[];
};

type ExecutedCase = {
    readonly result: PerTestResult;
    readonly runnerErrors: readonly RunnerError[];
    readonly durationMicroseconds: number;
};

type FailedBodyInput = {
    readonly context: BodyResultContext;
    readonly error: unknown;
    readonly testCase: TestPlanCase;
};

type CompletedBodyInput = {
    readonly assertionResult: AssertionResult;
    readonly context: BodyResultContext;
};

type BodyResultContext = {
    readonly cleanupErrors: readonly BodyErrorRecord[];
    readonly contractFailures: readonly TestContractFailure[];
    readonly recorder: AssertionRecorder;
    readonly runnerErrors: readonly RunnerError[];
};

type FinishedCaseCleanup = {
    readonly cleanupErrors: readonly BodyErrorRecord[];
    readonly runnerErrors: readonly RunnerError[];
};
type FinishedScope = {
    readonly cleanupErrors: readonly unknown[];
    readonly lifecycleFailures: readonly TestContractFailure[];
};

export type RunTestCaseOptions = {
    readonly controller: AbortController;
    readonly runtimePolicy: TestRuntimePolicy | null;
};

export type TestRuntimePolicy = {
    readonly runCase: <Value>(testCase: TestPlanCase, run: () => Promise<Value>) => Promise<Value>;
    readonly runLoad: <Value>(run: () => Promise<Value>) => Promise<Value>;
    readonly takeCaseErrors: (testCase: TestPlanCase) => readonly RunnerError[];
    readonly takePendingRunErrors: () => readonly RunnerError[];
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

function caseRunnerError(testCase: TestPlanCase, error: unknown): RunnerError | null {
    return isCaseRunnerError(error) ? error.runnerError(testCase.id, testCase.workId) : null;
}

function requireFailedBody(context: BodyResultContext): ExecutedBody {
    const { cleanupErrors, contractFailures, recorder, runnerErrors } = context;

    return {
        bodyError: null,
        cleanupErrors,
        contractFailures,
        requireFailed: true,
        runnerErrors,
        returnedAssertions: recorder.activeRecordedAssertions()
    };
}

function contractFailedBody(
    context: BodyResultContext,
    contractFailures: readonly TestContractFailure[]
): ExecutedBody {
    const { cleanupErrors, recorder, runnerErrors } = context;

    return {
        bodyError: null,
        cleanupErrors,
        contractFailures,
        requireFailed: false,
        runnerErrors,
        returnedAssertions: recorder.activeRecordedAssertions()
    };
}

function bodyErrorResult(context: BodyResultContext, error: unknown): ExecutedBody {
    const { cleanupErrors, contractFailures, recorder, runnerErrors } = context;

    return {
        bodyError: createThrownErrorRecord(error),
        cleanupErrors,
        contractFailures,
        requireFailed: false,
        runnerErrors,
        returnedAssertions: recorder.activeRecordedAssertions()
    };
}

function caseRunnerErrorBody(
    context: BodyResultContext,
    runnerError: RunnerError
): ExecutedBody {
    const { cleanupErrors, contractFailures, recorder, runnerErrors } = context;

    return {
        bodyError: null,
        cleanupErrors,
        contractFailures,
        requireFailed: false,
        runnerErrors: [ runnerError, ...runnerErrors ],
        returnedAssertions: recorder.activeRecordedAssertions()
    };
}

function nodeAssertionFailedBody(
    testCase: TestPlanCase,
    recorder: AssertionRecorder,
    error: unknown
): ExecutedBody {
    return {
        bodyError: null,
        cleanupErrors: [],
        contractFailures: [],
        requireFailed: false,
        runnerErrors: [],
        returnedAssertions: [
            ...recorder.activeRecordedAssertions(),
            nodeAssertionErrorFailure(error, testCase.definitionLocations[0])
        ]
    };
}

function completedBody(input: CompletedBodyInput): ExecutedBody {
    const { assertionResult, context } = input;
    const { recorder } = context;

    if (recorder.requireFailed()) {
        return requireFailedBody(context);
    }

    const returnedAssertions = recorder.returnedAssertions(assertionResult);

    if (isTestContractFailure(returnedAssertions)) {
        return contractFailedBody(context, [ returnedAssertions, ...context.contractFailures ]);
    }

    return {
        bodyError: null,
        cleanupErrors: context.cleanupErrors,
        contractFailures: context.contractFailures,
        requireFailed: false,
        runnerErrors: context.runnerErrors,
        returnedAssertions
    };
}

function completedThrowingBody(recorder: AssertionRecorder): ExecutedBody {
    if (recorder.requireFailed()) {
        return requireFailedBody({
            cleanupErrors: [],
            contractFailures: [],
            recorder,
            runnerErrors: []
        });
    }

    const returnedAssertions = recorder.completedThrowingAssertions();

    return isTestContractFailure(returnedAssertions)
        ? contractFailedBody({
            cleanupErrors: [],
            contractFailures: [],
            recorder,
            runnerErrors: []
        }, [ returnedAssertions ])
        : {
            bodyError: null,
            cleanupErrors: [],
            contractFailures: [],
            requireFailed: false,
            runnerErrors: [],
            returnedAssertions
        };
}

function nonRunnerFailedBody(input: FailedBodyInput): ExecutedBody {
    const { context, error, testCase } = input;
    const { recorder } = context;

    if (error instanceof RequireFailedSignalError) {
        return requireFailedBody(context);
    }

    if (error instanceof TestContractSignalError) {
        return contractFailedBody(context, [ error.failure(), ...context.contractFailures ]);
    }

    if (
        testCase.execution.kind === 'body' &&
        testCase.execution.bodyMode === 'throwing' &&
        isNodeAssertionError(error)
    ) {
        return nodeAssertionFailedBody(testCase, recorder, error);
    }

    return bodyErrorResult(context, error);
}

function failedBody(input: FailedBodyInput): ExecutedBody {
    const { context, error, testCase } = input;
    const runnerError = caseRunnerError(testCase, error);

    if (runnerError !== null) {
        return caseRunnerErrorBody(context, runnerError);
    }

    return nonRunnerFailedBody(input);
}

function finishedCaseCleanup(testCase: TestPlanCase, cleanupErrors: readonly unknown[]): FinishedCaseCleanup {
    const bodyErrors: BodyErrorRecord[] = [];
    const runnerErrors: RunnerError[] = [];

    for (const error of cleanupErrors) {
        const runnerError = caseRunnerError(testCase, error);

        if (runnerError === null) {
            bodyErrors.push(createThrownErrorRecord(error));
        } else {
            runnerErrors.push(runnerError);
        }
    }

    return {
        cleanupErrors: bodyErrors,
        runnerErrors
    };
}

function bodyResultContext(
    recorder: AssertionRecorder,
    testCase: TestPlanCase,
    finishedScope: FinishedScope
): BodyResultContext {
    const cleanup = finishedCaseCleanup(testCase, finishedScope.cleanupErrors);

    return {
        cleanupErrors: cleanup.cleanupErrors,
        contractFailures: finishedScope.lifecycleFailures,
        recorder,
        runnerErrors: cleanup.runnerErrors
    };
}

async function runBuilderCaseBody(
    testCase: TestPlanCase,
    recorder: AssertionRecorder,
    options: RunTestCaseOptions
): Promise<ExecutedBody> {
    const lifecycle = createTestScopeLifecycle(recorder);
    const runBody = async function runUserBody(): Promise<AssertionResult> {
        if (testCase.execution.kind !== 'body' || testCase.execution.bodyMode !== 'builder') {
            throw new TypeError('Non-builder test cases do not have builder bodies.');
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

        return completedBody({
            assertionResult,
            context: bodyResultContext(recorder, testCase, await lifecycle.finish(options.controller))
        });
    } catch (error: unknown) {
        return failedBody({
            context: bodyResultContext(recorder, testCase, await lifecycle.finish(options.controller)),
            error,
            testCase
        });
    }
}

async function runThrowingCaseBody(
    testCase: TestPlanCase,
    recorder: AssertionRecorder,
    options: RunTestCaseOptions
): Promise<ExecutedBody> {
    const runBody = async function runUserBody(): Promise<void> {
        if (testCase.execution.kind !== 'body' || testCase.execution.bodyMode !== 'throwing') {
            throw new TypeError('Non-throwing test cases do not have throwing bodies.');
        }

        await testCase.execution.body(createThrowingTestScope(recorder, options.controller.signal));
    };
    const runPolicyCheckedBody = async function runPolicyCheckedUserBody(): Promise<void> {
        if (options.runtimePolicy === null) {
            await runBody();

            return;
        }

        await options.runtimePolicy.runCase(testCase, runBody);
    };

    try {
        await runPolicyCheckedBody();

        return completedThrowingBody(recorder);
    } catch (error: unknown) {
        return failedBody({
            context: {
                cleanupErrors: [],
                contractFailures: [],
                recorder,
                runnerErrors: []
            },
            error,
            testCase
        });
    }
}

async function runCaseBody(
    testCase: TestPlanCase,
    recorder: AssertionRecorder,
    options: RunTestCaseOptions
): Promise<ExecutedBody> {
    if (testCase.execution.kind !== 'body') {
        throw new TypeError('Skipped test cases do not have executable bodies.');
    }

    return testCase.execution.bodyMode === 'builder'
        ? await runBuilderCaseBody(testCase, recorder, options)
        : await runThrowingCaseBody(testCase, recorder, options);
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
        executedBody.cleanupErrors.length > 0 ||
        executedBody.runnerErrors.length > 0
    ) {
        return null;
    }

    return recorder.validateAssertionCount(executedBody.returnedAssertions.length);
}

function createInconclusiveOutcome(executedBody: ExecutedBody): TestOutcome | null {
    const [ runnerError ] = executedBody.runnerErrors;

    if (runnerError === undefined) {
        return null;
    }

    return {
        kind: 'inconclusive',
        reason: runnerError.message
    };
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
        return createInconclusiveOutcome(executedBody) ?? { kind: 'pass' };
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

function skippedCase(
    testCase: TestPlanCase,
    reason: Extract<TestOutcome, { readonly kind: 'skip'; }>['reason'],
    durationMicroseconds: number
): ExecutedCase {
    const outcome: TestOutcome = { kind: 'skip', reason };

    return {
        result: {
            id: testCase.id,
            outcome,
            verdict: verdictFromOutcome(outcome),
            workId: testCase.workId,
            durationMicroseconds
        },
        runnerErrors: [],
        durationMicroseconds
    };
}

export async function runTestCase(
    testCase: TestPlanCase,
    wallClock: OverkillClock,
    options: RunTestCaseOptions = defaultRunTestCaseOptions()
): Promise<ExecutedCase> {
    const startedAtMicroseconds = wallClock.currentMonotonicMicroseconds;

    if (testCase.execution.kind === 'skip') {
        return skippedCase(
            testCase,
            testCase.execution.reason,
            wallClock.currentMonotonicMicroseconds - startedAtMicroseconds
        );
    }

    const recorder = createAssertionRecorder();

    const executedBody = await runCaseBody(testCase, recorder, options);
    const outcome = createOutcome(recorder, executedBody);
    const verdict = verdictFromOutcome(outcome);
    const durationMicroseconds = wallClock.currentMonotonicMicroseconds - startedAtMicroseconds;

    return {
        result: {
            id: testCase.id,
            outcome,
            verdict,
            workId: testCase.workId,
            durationMicroseconds
        },
        runnerErrors: executedBody.runnerErrors,
        durationMicroseconds
    };
}
