import { createThrownErrorRecord, type ThrownErrorRecord } from '../assertion-protocol/thrown-error-record.ts';
import {
    isTestContractFailure,
    RequireFailedSignalError,
    TestContractSignalError,
    type AssertionRecorder
} from './assertion-recorder.ts';
import { isNodeAssertionError, nodeAssertionErrorFailure } from './node-assertion-error.ts';
import {
    type TestContractFailure,
    isCaseRunnerError,
    permissionDeniedRunnerErrorFromThrown,
    type RunnerError
} from './run-result.ts';
import type { ExecutedBody } from './body-result.ts';
import { isPropertyTermination } from './property-execution-host.ts';
import type { TestPlanCase } from './test-plan.ts';

type FinishedCaseCleanup = {
    readonly cleanupErrors: readonly ThrownErrorRecord[];
    readonly runnerErrors: readonly RunnerError[];
};
function caseRunnerError(testCase: TestPlanCase, error: unknown): RunnerError | null {
    if (isCaseRunnerError(error)) {
        return error.runnerError(testCase.id, testCase.workId);
    }

    return permissionDeniedRunnerErrorFromThrown(error, {
        attributedTo: testCase.id,
        attributedToWork: testCase.workId,
        boundary: null,
        diagnosticChannel: null,
        hook: null,
        phase: 'body'
    });
}

function finishedCaseCleanup(testCase: TestPlanCase, cleanupErrors: readonly unknown[]): FinishedCaseCleanup {
    const bodyErrors: ThrownErrorRecord[] = [];
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

type AssertionResult = Parameters<AssertionRecorder['returnedAssertions']>[0];

type BodyErrorRecord = ThrownErrorRecord;

type FailedBodyInput = {
    readonly context: BodyResultContext;
    readonly error: unknown;
    readonly testCase: TestPlanCase;
};

type CompletedBodyInput = {
    readonly assertionResult: AssertionResult;
    readonly context: BodyResultContext;
};

export type BodyResultContext = {
    readonly cleanupErrors: readonly BodyErrorRecord[];
    readonly contractFailures: readonly TestContractFailure[];
    readonly recorder: AssertionRecorder;
    readonly runnerErrors: readonly RunnerError[];
};

type FinishedScope = {
    readonly cleanupErrors: readonly unknown[];
    readonly lifecycleFailures: readonly TestContractFailure[];
};

function requireFailedBody(context: BodyResultContext): ExecutedBody {
    const { cleanupErrors, contractFailures, recorder, runnerErrors } = context;

    return {
        bodyError: null,
        inconclusiveReason: null,
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
        inconclusiveReason: null,
        cleanupErrors,
        contractFailures,
        requireFailed: false,
        runnerErrors,
        returnedAssertions: recorder.activeRecordedAssertions()
    };
}

export function bodyErrorResult(context: BodyResultContext, error: unknown): ExecutedBody {
    const { cleanupErrors, contractFailures, recorder, runnerErrors } = context;

    return {
        bodyError: createThrownErrorRecord(error),
        inconclusiveReason: null,
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
        inconclusiveReason: null,
        cleanupErrors,
        contractFailures,
        requireFailed: false,
        runnerErrors: [ runnerError, ...runnerErrors ],
        returnedAssertions: recorder.activeRecordedAssertions()
    };
}

function nodeAssertionFailedBody(
    testCase: TestPlanCase,
    context: BodyResultContext,
    error: unknown
): ExecutedBody {
    return {
        bodyError: null,
        inconclusiveReason: null,
        cleanupErrors: context.cleanupErrors,
        contractFailures: context.contractFailures,
        requireFailed: false,
        runnerErrors: context.runnerErrors,
        returnedAssertions: [
            ...context.recorder.activeRecordedAssertions(),
            nodeAssertionErrorFailure(error, testCase.definitionLocations[0])
        ]
    };
}

export function completedBody(input: CompletedBodyInput): ExecutedBody {
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
        inconclusiveReason: null,
        cleanupErrors: context.cleanupErrors,
        contractFailures: context.contractFailures,
        requireFailed: false,
        runnerErrors: context.runnerErrors,
        returnedAssertions
    };
}

export function completedThrowingBody(recorder: AssertionRecorder): ExecutedBody {
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
            inconclusiveReason: null,
            cleanupErrors: [],
            contractFailures: [],
            requireFailed: false,
            runnerErrors: [],
            returnedAssertions
        };
}

function nonRunnerFailedBody(input: FailedBodyInput): ExecutedBody {
    const { context, error } = input;

    if (error instanceof RequireFailedSignalError) {
        return requireFailedBody(context);
    }

    if (error instanceof TestContractSignalError) {
        return contractFailedBody(context, [ error.failure(), ...context.contractFailures ]);
    }

    if (
        input.testCase.execution.kind === 'body' &&
        input.testCase.execution.bodyMode === 'throwing' &&
        isNodeAssertionError(error)
    ) {
        return nodeAssertionFailedBody(input.testCase, context, error);
    }

    return bodyErrorResult(context, error);
}

export function failedBody(input: FailedBodyInput): ExecutedBody {
    const { context, error, testCase } = input;
    if (isPropertyTermination(error)) {
        return {
            ...error.result,
            cleanupErrors: [ ...error.result.cleanupErrors, ...context.cleanupErrors ],
            contractFailures: [ ...error.result.contractFailures, ...context.contractFailures ],
            runnerErrors: [ ...error.result.runnerErrors, ...context.runnerErrors ]
        };
    }
    const runnerError = caseRunnerError(testCase, error);

    if (runnerError !== null) {
        return caseRunnerErrorBody(context, runnerError);
    }

    return nonRunnerFailedBody(input);
}

export function bodyResultContext(
    recorder: AssertionRecorder,
    testCase: TestPlanCase,
    finishedScope: FinishedScope,
    sampleCleanupErrors: readonly unknown[]
): BodyResultContext {
    const cleanup = finishedCaseCleanup(testCase, [ ...sampleCleanupErrors, ...finishedScope.cleanupErrors ]);

    return {
        cleanupErrors: cleanup.cleanupErrors,
        contractFailures: finishedScope.lifecycleFailures,
        recorder,
        runnerErrors: cleanup.runnerErrors
    };
}
