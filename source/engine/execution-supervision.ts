import type { Clock } from '@enormora/clock';
import type { BenchmarkExecutionEnvironment } from './benchmark-environment.ts';
import {
    invalidTimeoutControlFailure,
    runTestCase,
    timeoutFailure,
    type RunTestCaseOptions
} from './case-execution.ts';
import { workIdentityKey, type AttemptId, type WorkId } from './identity.ts';
import {
    singleAttemptResult,
    isPermissionDeniedRunnerError,
    verdictFromOutcome,
    type PerTestResult,
    type RunnerError,
    type TestFailure
} from './run-result.ts';
import type { ExecuteProcessBudgets, ProcessUsageSnapshot } from './process-usage.ts';
import type { TestPlanCase } from './test-plan.ts';
import {
    findProcessBudgetBreach,
    processExhaustionError,
    type ProcessExhaustionCause,
    type ProcessBudgetBreach
} from './execution-process-budget-breach.ts';
import type { ExecutionGlobalErrorObserver } from './execution-global-error-observer.ts';
import {
    createExecutionSupervision as createExecutionSupervisionState,
    createBenchmarkState,
    crashError,
    type CrashCause,
    recordNativeBoundaryFailure,
    createCaseCompletion,
    scheduleSupervisionTimeout,
    clearSupervisionTimeout,
    type BenchmarkState,
    type ActiveCase as SupervisedActiveCase,
    type CaseCompletion,
    type ExecutionConcurrentCase,
    type ExecutionSupervision as ExecutionSupervisionState
} from './execution-supervision-state.ts';

const microsecondsPerMillisecond = 1000;

export type ExecuteTimeoutPolicy = {
    readonly hardTimeoutMilliseconds: number;
    readonly timeoutMilliseconds: number;
};
export type ConcurrentCase = ExecutionConcurrentCase;
export type ExecutionSupervisionDependencies = {
    readonly benchmarkEnvironment: BenchmarkExecutionEnvironment | null;
    readonly globalErrorObserver: ExecutionGlobalErrorObserver;
    readonly runtimePolicy?: RunTestCaseOptions['runtimePolicy'];
    readonly wallClock: Clock;
};
type TestFailures = readonly [TestFailure, ...TestFailure[]];

export type ExecutionSupervision = ExecutionSupervisionState;

type SoftTimeoutResolution = {
    readonly failure: TestFailure;
    readonly kind: 'failure';
} | {
    readonly kind: 'milliseconds';
    readonly milliseconds: number | null;
};

type CaseExecutionInput = {
    readonly seed: bigint;
    readonly propertyRun: RunTestCaseOptions['propertyRun'];
    readonly onPropertyUpdate: RunTestCaseOptions['onPropertyUpdate'];
    readonly onBenchmarkUpdate: RunTestCaseOptions['onBenchmarkUpdate'];
    readonly attempt: AttemptId;
    readonly dependencies: ExecutionSupervisionDependencies;
    readonly supervision: ExecutionSupervision;
    readonly testCase: TestPlanCase;
    readonly timeoutPolicy: ExecuteTimeoutPolicy | null | undefined;
};

type ActiveCaseInput = CaseExecutionInput & {
    readonly benchmark: BenchmarkState;
    readonly completion: CaseCompletion;
    readonly controller: AbortController;
};

type CaseBodyInput = ActiveCaseInput & {
    readonly activeCase: SupervisedActiveCase;
    readonly timeoutMilliseconds: number | null;
};

type ProcessUsageSampleInput = {
    readonly budgets: ExecuteProcessBudgets | null | undefined;
    readonly dependencies: ExecutionSupervisionDependencies;
    readonly previousSample: ProcessUsageSnapshot | null;
    readonly sample: ProcessUsageSnapshot;
    readonly supervision: ExecutionSupervision;
};

export const createExecutionSupervision: () => ExecutionSupervision = createExecutionSupervisionState;

function createTerminalCase(
    testCase: TestPlanCase,
    verdict: PerTestResult['verdict'],
    durationMicroseconds: number,
    benchmark: PerTestResult['benchmark']
): ConcurrentCase {
    return {
        result: singleAttemptResult({
            benchmark: benchmark === null ? null : { ...benchmark, status: 'incomplete' },
            definitionLocations: testCase.definitionLocations,
            id: testCase.id,
            outcome: null,
            verdict,
            workId: testCase.workId,
            durationMicroseconds
        }, { index: 0 }),
        runnerErrors: [],
        durationMicroseconds
    };
}
function failCase(
    testCase: Pick<TestPlanCase, 'definitionLocations' | 'id' | 'workId'>,
    failures: TestFailures,
    durationMicroseconds: number,
    benchmark: PerTestResult['benchmark']
): PerTestResult {
    const outcome = {
        failures,
        kind: 'fail'
    } as const;

    return singleAttemptResult({
        benchmark,
        definitionLocations: testCase.definitionLocations,
        id: testCase.id,
        outcome,
        verdict: verdictFromOutcome(outcome),
        workId: testCase.workId,
        durationMicroseconds
    }, { index: 0 });
}
function timeoutControlValue(testCase: TestPlanCase): unknown {
    return testCase.controls.timeoutMilliseconds;
}

function isPositiveSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function resolveSoftTimeout(
    testCase: TestPlanCase,
    policy: ExecuteTimeoutPolicy | null | undefined
): SoftTimeoutResolution {
    if (policy === null || policy === undefined) {
        return { kind: 'milliseconds', milliseconds: null };
    }

    const controlTimeout = timeoutControlValue(testCase);

    if (controlTimeout === null) {
        return { kind: 'milliseconds', milliseconds: policy.timeoutMilliseconds };
    }

    if (isPositiveSafeInteger(controlTimeout) && controlTimeout <= policy.timeoutMilliseconds) {
        return { kind: 'milliseconds', milliseconds: controlTimeout };
    }

    return {
        failure: invalidTimeoutControlFailure(
            controlTimeout,
            `positive safe integer <= ${policy.timeoutMilliseconds}`
        ),
        kind: 'failure'
    };
}

function resultWithTimeoutFailure(
    executedCase: ConcurrentCase,
    deadlineMilliseconds: number,
    elapsedMilliseconds: number
): ConcurrentCase {
    const failure = timeoutFailure(deadlineMilliseconds, elapsedMilliseconds);
    const { outcome } = executedCase.result;

    if (outcome?.kind === 'fail') {
        return {
            ...executedCase,
            result: {
                ...executedCase.result,
                outcome: {
                    failures: [ ...outcome.failures, failure ],
                    kind: 'fail'
                },
                verdict: 'fail'
            }
        };
    }

    return {
        ...executedCase,
        result: failCase(
            executedCase.result,
            [ failure ],
            executedCase.durationMicroseconds,
            executedCase.result.benchmark
        )
    };
}

function casePolicyResult(executedCase: ConcurrentCase, errors: readonly RunnerError[]): ConcurrentCase {
    const hasCasePolicyError = executedCase.runnerErrors.some(function policyError(error) {
        return isPermissionDeniedRunnerError(error) || error.subtype === 'runtime-policy';
    });

    if (errors.length === 0 && !hasCasePolicyError) {
        return executedCase;
    }

    return {
        ...executedCase,
        result: { ...executedCase.result, outcome: null, verdict: 'runtime-policy' },
        runnerErrors: [ ...executedCase.runnerErrors, ...errors ]
    };
}

async function runTestCaseWithPolicy(
    input: ActiveCaseInput
): Promise<ConcurrentCase> {
    const executedCase = await runTestCase(input.testCase, input.dependencies.wallClock, {
        seed: input.seed,
        async onBenchmarkUpdate(result) {
            input.benchmark.write(result);
            await input.onBenchmarkUpdate(result);
        },
        onPropertyUpdate: input.onPropertyUpdate,
        propertyRun: input.propertyRun,
        benchmarkEnvironment: input.dependencies.benchmarkEnvironment,
        attempt: input.attempt,
        controller: input.controller,
        runtimePolicy: input.dependencies.runtimePolicy ?? null,
        interruption: input.completion.promise
    });

    return casePolicyResult(
        executedCase,
        input.dependencies.runtimePolicy?.takeAttemptErrors(input.testCase, input.attempt) ?? []
    );
}

function activeCaseIds(activeCases: ReadonlyMap<string, SupervisedActiveCase>): readonly TestPlanCase['id'][] {
    return Array.from(activeCases.values(), function toCaseId(activeCase) {
        return activeCase.testCase.id;
    });
}

function activeWorkIds(activeCases: ReadonlyMap<string, SupervisedActiveCase>): readonly WorkId[] {
    return Array.from(activeCases.values(), function toWorkId(activeCase) {
        return activeCase.testCase.workId;
    });
}

function completeActiveCasesAs(
    supervision: ExecutionSupervision,
    verdict: PerTestResult['verdict'],
    dependencies: ExecutionSupervisionDependencies
): void {
    supervision.stopAcceptingCases();

    for (const [ key, activeCase ] of supervision.activeCases) {
        supervision.removeActiveCase(key);
        activeCase.abort();
        clearSupervisionTimeout(dependencies.wallClock, activeCase.hardTimeout);
        activeCase.completion.complete(createTerminalCase(
            activeCase.testCase,
            verdict,
            Number(dependencies.wallClock.currentMonotonicMicroseconds) - activeCase.startedAtMicroseconds,
            activeCase.benchmark.read()
        ));
    }
}

function completeActiveCasesWithCrash(
    supervision: ExecutionSupervision,
    dependencies: ExecutionSupervisionDependencies
): void {
    const cause: CrashCause = {
        activeAttempts: Array.from(supervision.activeCases.values(), function attempt(active) {
            return active.attempt;
        }),
        activeCases: activeCaseIds(supervision.activeCases),
        activeWork: activeWorkIds(supervision.activeCases),
        reason: 'hard-timeout',
        termination: 'hard-timeout'
    };

    if (cause.activeCases.length > 0) {
        recordNativeBoundaryFailure(
            {
                kind: 'worker-crash',
                reason: cause.reason,
                exitCode: null,
                signal: null,
                coreDumpPath: null,
                nativeAddons: null
            },
            supervision,
            dependencies.wallClock
        );
        supervision.recordRunnerError(crashError(cause));
        completeActiveCasesAs(supervision, 'crashed', dependencies);
    }
}

function completeActiveCasesAfterGlobalError(
    supervision: ExecutionSupervision,
    dependencies: ExecutionSupervisionDependencies
): void {
    supervision.stopAcceptingCases();

    if (supervision.activeCases.size > 0) {
        completeActiveCasesAs(supervision, 'crashed', dependencies);
    }
}

function completeActiveCasesWithProcessExhaustion(
    breach: ProcessBudgetBreach,
    supervision: ExecutionSupervision,
    dependencies: ExecutionSupervisionDependencies,
    previousSample: ProcessUsageSnapshot | null
): void {
    supervision.stopAcceptingCases();

    const cause: ProcessExhaustionCause = {
        ...breach,
        activeAttempts: Array.from(supervision.activeCases.values(), function attempt(active) {
            return active.attempt;
        }),
        activeCases: activeCaseIds(supervision.activeCases),
        activeWork: activeWorkIds(supervision.activeCases),
        enforcement: 'sampled'
    };

    recordNativeBoundaryFailure(
        {
            kind: 'process-exhaustion',
            metric: breach.metric,
            budget: breach.budget,
            observed: breach.observed,
            enforcement: cause.activeCases.length === 0 ? 'post-test-diagnostic' : 'sampled',
            processUsageSamplingIntervalMilliseconds: null,
            samples: previousSample === null ? [ breach.sample ] : [ previousSample, breach.sample ]
        },
        supervision,
        dependencies.wallClock
    );
    if (cause.activeCases.length === 0) {
        supervision.recordRunnerError(processExhaustionError({
            ...cause,
            enforcement: 'post-test-diagnostic'
        }));
        return;
    }

    supervision.recordRunnerError(processExhaustionError(cause));
    completeActiveCasesAs(supervision, 'process-exhausted', dependencies);
}

async function runCaseWithSoftTimeout(
    input: CaseBodyInput
): Promise<ConcurrentCase> {
    if (input.timeoutMilliseconds === null) {
        return await runTestCaseWithPolicy(input);
    }

    const timing = { timedOut: false };
    const softTimeout = scheduleSupervisionTimeout(input.dependencies.wallClock, function abortTimedOutCase() {
        timing.timedOut = true;
        input.controller.abort();
    }, input.timeoutMilliseconds);
    const executedCase = await runTestCaseWithPolicy(input);

    clearSupervisionTimeout(input.dependencies.wallClock, softTimeout);

    const deadlineMicroseconds = input.timeoutMilliseconds * microsecondsPerMillisecond;

    if (
        !input.supervision.hasTerminalError() &&
        (timing.timedOut || executedCase.durationMicroseconds >= deadlineMicroseconds)
    ) {
        return resultWithTimeoutFailure(
            executedCase,
            input.timeoutMilliseconds,
            executedCase.durationMicroseconds / microsecondsPerMillisecond
        );
    }

    return executedCase;
}

function invalidTimeoutCase(testCase: TestPlanCase, failure: TestFailure): ConcurrentCase {
    return {
        result: failCase(testCase, [ failure ], 0, null),
        runnerErrors: [],
        durationMicroseconds: 0
    };
}

function registerActiveCase(input: ActiveCaseInput): SupervisedActiveCase {
    const key = workIdentityKey(input.testCase.workId);
    const startedAtMicroseconds = Number(input.dependencies.wallClock.currentMonotonicMicroseconds);
    const hardTimeout = input.timeoutPolicy === null || input.timeoutPolicy === undefined
        ? null
        : scheduleSupervisionTimeout(input.dependencies.wallClock, function hardTimeoutActiveCases() {
            completeActiveCasesWithCrash(input.supervision, input.dependencies);
        }, input.timeoutPolicy.hardTimeoutMilliseconds);
    const activeCase: SupervisedActiveCase = {
        benchmark: input.benchmark,
        attempt: input.attempt,
        abort() {
            input.controller.abort();
        },
        completion: input.completion,
        hardTimeout,
        startedAtMicroseconds,
        testCase: input.testCase
    };

    input.supervision.addActiveCase(key, activeCase);

    return activeCase;
}

function completeFinishedActiveCase(input: CaseBodyInput, executedCase: ConcurrentCase): void {
    const key = workIdentityKey(input.testCase.workId);

    if (input.supervision.activeCases.get(key) === input.activeCase) {
        input.supervision.removeActiveCase(key);
        clearSupervisionTimeout(input.dependencies.wallClock, input.activeCase.hardTimeout);
        input.completion.complete(executedCase);
    }
}

function createInconclusiveCaseResult(
    testCase: TestPlanCase,
    error: unknown,
    durationMicroseconds: number
): PerTestResult {
    const reason = error instanceof Error ? error.message : 'Unknown test execution error.';
    const outcome = {
        kind: 'inconclusive',
        reason: `Test execution failed before producing a result: ${reason}`
    } as const;

    return singleAttemptResult({
        definitionLocations: testCase.definitionLocations,
        id: testCase.id,
        outcome,
        verdict: verdictFromOutcome(outcome),
        workId: testCase.workId,
        durationMicroseconds
    }, { index: 0 });
}
function isCancelledCompletion(input: CaseBodyInput, result: PerTestResult): boolean {
    if (result.outcome?.kind !== 'fail') {
        return result.verdict === 'pass';
    }
    return result.outcome.failures.every(function cancellationFailure(failure) {
        return failure.kind === 'body-error' && failure.error.thrown === input.controller.signal.reason;
    });
}

function cancelledCaseResult(input: CaseBodyInput, executed: ConcurrentCase): ConcurrentCase {
    if (!input.supervision.wasCancelled() || !isCancelledCompletion(input, executed.result)) {
        return executed;
    }
    return {
        ...executed,
        result: createInconclusiveCaseResult(
            input.testCase,
            new Error('Family execution was cancelled.'),
            executed.durationMicroseconds
        )
    };
}

async function runCaseBodyUnderSupervision(input: CaseBodyInput): Promise<ConcurrentCase> {
    const removeFatalHandler = input.dependencies.globalErrorObserver.onFatalError(function completeCrashedCases() {
        completeActiveCasesAfterGlobalError(input.supervision, input.dependencies);
    });

    try {
        const executedCase = cancelledCaseResult(input, await runCaseWithSoftTimeout(input));
        completeFinishedActiveCase(input, executedCase);
        return executedCase;
    } catch (error: unknown) {
        const durationMicroseconds = Number(input.dependencies.wallClock.currentMonotonicMicroseconds) -
            input.activeCase.startedAtMicroseconds;
        const fallbackCase = {
            result: createInconclusiveCaseResult(input.testCase, error, durationMicroseconds),
            runnerErrors: [],
            durationMicroseconds
        };

        completeFinishedActiveCase(input, fallbackCase);
        return fallbackCase;
    } finally {
        removeFatalHandler();
    }
}

function registerCaseBodyInput(input: ActiveCaseInput, timeoutMilliseconds: number | null): CaseBodyInput {
    return {
        ...input,
        activeCase: registerActiveCase(input),
        timeoutMilliseconds
    };
}

function createActiveCaseInput(
    input: CaseExecutionInput
): ActiveCaseInput {
    return {
        ...input,
        benchmark: createBenchmarkState(),
        completion: createCaseCompletion(),
        controller: new AbortController()
    };
}

export function recordProcessUsageSample(input: ProcessUsageSampleInput): boolean {
    const breach = findProcessBudgetBreach(input.budgets, input.sample, input.previousSample);

    if (breach === null) {
        return false;
    }

    completeActiveCasesWithProcessExhaustion(breach, input.supervision, input.dependencies, input.previousSample);

    return true;
}

export async function executeCaseBody(input: CaseExecutionInput): Promise<ConcurrentCase> {
    if (input.dependencies.globalErrorObserver.hasFatalError() || !input.supervision.acceptsNewCases()) {
        return createTerminalCase(input.testCase, input.supervision.closedBoundaryVerdict(), 0, null);
    }
    if (input.testCase.execution.kind === 'skip') {
        return await runTestCase(input.testCase, input.dependencies.wallClock);
    }

    const timeoutResolution = resolveSoftTimeout(input.testCase, input.timeoutPolicy);

    if (timeoutResolution.kind === 'failure') {
        return invalidTimeoutCase(input.testCase, timeoutResolution.failure);
    }

    return await runCaseBodyUnderSupervision(registerCaseBodyInput(
        createActiveCaseInput(input),
        timeoutResolution.milliseconds
    ));
}
