import type { Clock } from '@enormora/clock';

import {
    createBenchmarkAttempt,
    bodyResultContext,
    bodyErrorResult,
    completedBody,
    completedThrowingBody,
    failedBody,
    type ExecutedBody,
    type BodyResultContext,
    builderBodyForAttempt,
    testBodyExecutionError,
    type BenchmarkAttempt
} from './case-body-execution.ts';
import { assertionFailure } from './recorded-assertion-failure.ts';
import {
    assertNonEmptyItems,
    createAssertionRecorder,
    type AssertionRecorder
} from './assertion-recorder.ts';
import {
    singleAttemptResult,
    type PerTestResult,
    type RunnerError,
    type TestContractFailure,
    type TestFailure,
    type TestOutcome,
    verdictFromOutcome
} from './run-result.ts';
import { createTestScopeLifecycle } from './test-scope-lifecycle.ts';
import { createThrowingTestScope } from './throwing-test-scope.ts';
import { createCaseInterruption, type CaseInterruption, type ExecutedCase } from './case-interruption.ts';
import type { TestPlanCase } from './test-plan.ts';

type AttemptId = PerTestResult['attempts'][number]['attempt'];
type AssertionResult = Parameters<AssertionRecorder['returnedAssertions']>[0];
type CaseExecutionOptions = {
    readonly benchmarkEnvironment: BenchmarkAttempt['benchmarkEnvironment'];
    readonly onBenchmarkUpdate: BenchmarkAttempt['updateResult'];
    readonly attempt: AttemptId;
    readonly controller: AbortController;
    readonly runtimePolicy: TestRuntimePolicy | null;
};

export type RunTestCaseOptions = CaseExecutionOptions & {
    readonly interruption: Promise<ExecutedCase> | null;
};

type CaseBodyOptions = CaseExecutionOptions & {
    readonly interruption: CaseInterruption;
};

export type TestRuntimePolicy = {
    readonly prepareAttempt: (testCase: TestPlanCase, attempt: AttemptId) => Promise<void>;
    readonly runAttempt: <Value>(
        testCase: TestPlanCase,
        attempt: AttemptId,
        run: () => Promise<Value>
    ) => Promise<Value>;
    readonly completeCase: (testCase: TestPlanCase, attempt: AttemptId) => Promise<void>;
    readonly runLoad: <Value>(run: () => Promise<Value>) => Promise<Value>;
    readonly takeAttemptErrors: (testCase: TestPlanCase, attempt: AttemptId) => readonly RunnerError[];
    readonly takePendingRunErrors: () => readonly RunnerError[];
    readonly takeRunErrors: () => readonly RunnerError[];
};

async function prepareCaseArtifacts(testCase: TestPlanCase, options: CaseBodyOptions): Promise<readonly unknown[]> {
    const policy = options.runtimePolicy;
    if (policy === null) {
        return [];
    }
    try {
        await policy.prepareAttempt(testCase, options.attempt);
        return [];
    } catch (error: unknown) {
        return [ error ];
    }
}

function interruptedBody(context: BodyResultContext): ExecutedBody {
    return {
        bodyError: null,
        cleanupErrors: context.cleanupErrors,
        contractFailures: context.contractFailures,
        requireFailed: context.recorder.requireFailed(),
        runnerErrors: context.runnerErrors,
        returnedAssertions: context.recorder.activeRecordedAssertions()
    };
}

async function runBuilderCaseBody(
    testCase: TestPlanCase,
    recorder: AssertionRecorder,
    options: CaseBodyOptions,
    benchmarkAttempt: BenchmarkAttempt
): Promise<ExecutedBody> {
    const lifecycle = createTestScopeLifecycle(recorder);
    const runBody = async function runUserBody(): Promise<AssertionResult> {
        return await lifecycle.runBody(
            options.controller.signal,
            builderBodyForAttempt(testCase, benchmarkAttempt)
        );
    };
    const runAndCleanUp = async function runBodyAndScopeCleanup(): Promise<ExecutedBody> {
        const completion = await options.interruption.run(runBody);
        const preparationErrors = await prepareCaseArtifacts(testCase, options);
        const context = bodyResultContext(
            recorder,
            testCase,
            await lifecycle.finish(options.controller),
            [ ...preparationErrors, ...benchmarkAttempt.cleanupErrors() ]
        );
        if (completion.kind === 'returned') {
            return completedBody({ assertionResult: completion.value, context });
        }
        return completion.kind === 'threw'
            ? failedBody({ context, error: completion.error, testCase })
            : interruptedBody(context);
    };

    return options.runtimePolicy === null
        ? await runAndCleanUp()
        : await options.runtimePolicy.runAttempt(testCase, options.attempt, runAndCleanUp);
}

async function runThrowingCaseBody(
    testCase: TestPlanCase,
    recorder: AssertionRecorder,
    options: CaseBodyOptions
): Promise<ExecutedBody> {
    const runBody = async function runUserBody(): Promise<void> {
        if (testCase.execution.kind !== 'body' || testCase.execution.bodyMode !== 'throwing') {
            throw new TypeError('Non-throwing test cases do not have throwing bodies.');
        }

        await testCase.execution.body(createThrowingTestScope(recorder, options.controller.signal));
    };
    const runAndPrepare = async function runThrowingBodyAndPreparation(): Promise<ExecutedBody> {
        const completion = await options.interruption.run(runBody);
        const preparationErrors = await prepareCaseArtifacts(testCase, options);
        options.controller.abort();
        const context = bodyResultContext(
            recorder,
            testCase,
            { cleanupErrors: preparationErrors, lifecycleFailures: [] },
            []
        );
        if (completion.kind === 'threw') {
            return failedBody({ context, error: completion.error, testCase });
        }
        const body = completion.kind === 'returned' ? completedThrowingBody(recorder) : interruptedBody(context);
        return { ...body, cleanupErrors: context.cleanupErrors, runnerErrors: context.runnerErrors };
    };
    return options.runtimePolicy === null
        ? await runAndPrepare()
        : await options.runtimePolicy.runAttempt(testCase, options.attempt, runAndPrepare);
}

async function runCaseBody(
    testCase: TestPlanCase,
    recorder: AssertionRecorder,
    options: CaseBodyOptions,
    benchmarkAttempt: BenchmarkAttempt
): Promise<ExecutedBody> {
    if (testCase.execution.kind !== 'body') {
        throw new TypeError('Skipped test cases do not have executable bodies.');
    }

    const executionError = testBodyExecutionError(testCase);
    if (executionError !== null) {
        return bodyErrorResult({ cleanupErrors: [], contractFailures: [], recorder, runnerErrors: [] }, executionError);
    }

    return testCase.execution.bodyMode === 'throwing'
        ? await runThrowingCaseBody(testCase, recorder, options)
        : await runBuilderCaseBody(testCase, recorder, options, benchmarkAttempt);
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

function runnerErrorOutcome(executedBody: ExecutedBody): TestOutcome | null {
    const [ runnerError ] = executedBody.runnerErrors;

    if (runnerError === undefined) {
        return { kind: 'pass' };
    }
    if (
        executedBody.runnerErrors.every(function permissionFailure(error) {
            return error.subtype === 'permission';
        })
    ) {
        return null;
    }

    return {
        kind: 'inconclusive',
        reason: runnerError.message
    };
}

function createOutcome(
    recorder: AssertionRecorder,
    executedBody: ExecutedBody,
    generated: boolean
): TestOutcome | null {
    const failures = [
        assertionFailure(executedBody.returnedAssertions),
        ...bodyFailures(executedBody),
        generated ? null : planFailure(recorder, executedBody)
    ]
        .filter(function isTestFailure(failure): failure is TestFailure {
            return failure !== null;
        });

    if (failures.length === 0) {
        return runnerErrorOutcome(executedBody);
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
        async onBenchmarkUpdate() {
            return undefined;
        },
        benchmarkEnvironment: null,
        attempt: { index: 0 },
        controller,
        runtimePolicy: null,
        interruption: null
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
        result: singleAttemptResult({
            definitionLocations: testCase.definitionLocations,
            id: testCase.id,
            outcome,
            verdict: verdictFromOutcome(outcome),
            workId: testCase.workId,
            durationMicroseconds
        }, { index: 0 }),
        runnerErrors: [],
        durationMicroseconds
    };
}

function completedCaseOutcome(
    recorder: AssertionRecorder,
    body: ExecutedBody,
    terminal: ExecutedCase | null,
    generated: boolean
): Pick<PerTestResult, 'outcome' | 'verdict'> {
    const outcome = createOutcome(recorder, body, terminal !== null || generated);
    if (terminal !== null && (outcome === null || outcome.kind === 'pass')) {
        return { outcome: terminal.result.outcome, verdict: terminal.result.verdict };
    }
    return { outcome, verdict: outcome === null ? 'runtime-policy' : verdictFromOutcome(outcome) };
}

export async function runTestCase(
    testCase: TestPlanCase,
    wallClock: Clock,
    options: RunTestCaseOptions = defaultRunTestCaseOptions()
): Promise<ExecutedCase> {
    const startedAtMicroseconds = Number(wallClock.currentMonotonicMicroseconds);

    if (testCase.execution.kind === 'skip') {
        return skippedCase(
            testCase,
            testCase.execution.reason,
            Number(wallClock.currentMonotonicMicroseconds) - startedAtMicroseconds
        );
    }

    const execution = {
        recorder: createAssertionRecorder(),
        benchmark: createBenchmarkAttempt(testCase, options.onBenchmarkUpdate, options.benchmarkEnvironment),
        interruption: createCaseInterruption(options.interruption)
    };
    const completed = await runCaseBody(testCase, execution.recorder, {
        ...options,
        interruption: execution.interruption
    }, execution.benchmark);
    const executedBody = { ...completed, runnerErrors: [ ...completed.runnerErrors, ...execution.benchmark.errors() ] };
    const completion = completedCaseOutcome(
        execution.recorder,
        executedBody,
        execution.interruption.result(),
        testCase.execution.bodyMode === 'benchmark'
    );
    const durationMicroseconds = Number(wallClock.currentMonotonicMicroseconds) - startedAtMicroseconds;

    return {
        result: singleAttemptResult({
            benchmark: execution.interruption.result()?.result.benchmark ?? execution.benchmark.result(),
            definitionLocations: testCase.definitionLocations,
            id: testCase.id,
            ...completion,
            workId: testCase.workId,
            durationMicroseconds
        }, { index: 0 }),
        runnerErrors: executedBody.runnerErrors,
        durationMicroseconds
    };
}
