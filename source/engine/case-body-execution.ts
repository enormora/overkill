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
    type CaseRunnerError,
    type RunnerError
} from './run-result.ts';
import type { BenchmarkExecutionEnvironment } from './benchmark-environment.ts';
import { readTestBodyFamily } from './test-body.ts';
import type { BenchmarkExecutionResult } from './benchmark-result.ts';
import type { TestBody } from './test-node.ts';
import type { TestPlanCase } from './test-plan.ts';

export type BenchmarkAttempt = {
    readonly benchmarkEnvironment: BenchmarkExecutionEnvironment | null;
    readonly cleanupErrors: () => readonly unknown[];
    readonly reportCleanupError: (error: unknown) => void;
    readonly result: () => BenchmarkExecutionResult | null;
    readonly errors: () => readonly RunnerError[];
    readonly updateResult: (result: BenchmarkExecutionResult) => Promise<void>;
    readonly reportError: (error: CaseRunnerError) => void;
};

export function createBenchmarkAttempt(
    testCase: TestPlanCase,
    onUpdate: BenchmarkAttempt['updateResult'],
    benchmarkEnvironment: BenchmarkExecutionEnvironment | null
): BenchmarkAttempt {
    let result: BenchmarkExecutionResult | null = null;
    const errors: RunnerError[] = [];
    const cleanupErrors: unknown[] = [];
    return {
        benchmarkEnvironment,
        cleanupErrors() {
            return cleanupErrors;
        },
        reportCleanupError(error) {
            cleanupErrors.push(error);
        },
        result() {
            return result;
        },
        errors() {
            return errors;
        },
        async updateResult(updated) {
            result = updated;
            await onUpdate(updated);
        },
        reportError(error) {
            errors.push(error.runnerError(testCase.id, testCase.workId));
        }
    };
}

export function builderBodyForAttempt(
    testCase: TestPlanCase,
    attempt: BenchmarkAttempt
): TestBody {
    const { execution } = testCase;
    if (execution.kind !== 'body' || execution.bodyMode === 'throwing') {
        throw new TypeError('Test case does not have a builder body.');
    }
    if (execution.bodyMode === 'builder' || execution.bodyMode === 'property') {
        return execution.body;
    }
    const { workload } = testCase.workId;
    if (workload === null) {
        throw new TypeError('Benchmark execution requires a selected workload.');
    }
    return async function runBenchmark(scope) {
        return execution.body({
            workId: testCase.workId,
            benchmarkEnvironment: attempt.benchmarkEnvironment,
            reportCleanupError: attempt.reportCleanupError,
            cleanup: scope.cleanup,
            signal: scope.signal,
            workload,
            updateResult: attempt.updateResult,
            reportError: attempt.reportError
        });
    };
}

export function testBodyExecutionError(testCase: TestPlanCase): TypeError | null {
    const { execution } = testCase;
    if (execution.kind !== 'body') {
        return null;
    }
    if (execution.bodyMode === 'property' || readTestBodyFamily(execution.body)?.family === 'property') {
        return new TypeError(
            'Property execution is not available. Property policy and generator execution are required.'
        );
    }
    return null;
}

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
type AssertionNode = ReturnType<AssertionRecorder['activeRecordedAssertions']>[number];

type BodyErrorRecord = ThrownErrorRecord;

export type ExecutedBody = {
    readonly bodyError: BodyErrorRecord | null;
    readonly cleanupErrors: readonly BodyErrorRecord[];
    readonly contractFailures: readonly TestContractFailure[];
    readonly requireFailed: boolean;
    readonly runnerErrors: readonly RunnerError[];
    readonly returnedAssertions: readonly AssertionNode[];
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

export function bodyErrorResult(context: BodyResultContext, error: unknown): ExecutedBody {
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
    context: BodyResultContext,
    error: unknown
): ExecutedBody {
    return {
        bodyError: null,
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
            cleanupErrors: [],
            contractFailures: [],
            requireFailed: false,
            runnerErrors: [],
            returnedAssertions
        };
}

function nonRunnerFailedBody(input: FailedBodyInput): ExecutedBody {
    const { context, error, testCase } = input;

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
        return nodeAssertionFailedBody(testCase, context, error);
    }

    return bodyErrorResult(context, error);
}

export function failedBody(input: FailedBodyInput): ExecutedBody {
    const { context, error, testCase } = input;
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
