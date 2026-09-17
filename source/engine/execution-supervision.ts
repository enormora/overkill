import type { WallClock } from '@enormora/wall-clock';
import {
    invalidTimeoutControlFailure,
    runTestCase,
    timeoutFailure,
    type TestRuntimePolicy
} from './case-execution.ts';
import { workIdentityKey, type WorkId } from './identity.ts';
import {
    verdictFromOutcome,
    type PerTestResult,
    type ResourceUsageSnapshot,
    type RunnerError,
    type TestFailure
} from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';
import {
    findResourceBudgetBreach,
    type ExecuteResourceBudgets,
    type ResourceBudgetBreach
} from './execution-resource-budget-breach.ts';

export type ExecuteTimeoutPolicy = {
    readonly hardTimeoutMilliseconds: number;
    readonly timeoutMilliseconds: number;
};
export type ConcurrentCase = {
    readonly result: PerTestResult;
    readonly runnerErrors: readonly RunnerError[];
    readonly wallTimeMs: number;
};
export type ExecutionSupervisionDependencies = {
    readonly runtimePolicy?: TestRuntimePolicy | null;
    readonly wallClock: WallClock;
};
type CaseCompletion = {
    readonly complete: (executedCase: ConcurrentCase) => void;
    readonly promise: Promise<ConcurrentCase>;
};
type ActiveCase = {
    readonly abort: () => void;
    readonly completion: CaseCompletion;
    readonly hardTimeout: ReturnType<WallClock['setTimeout']> | null;
    readonly startedAtMilliseconds: number;
    readonly testCase: TestPlanCase;
};
type TestFailures = readonly [TestFailure, ...TestFailure[]];

type ResourceExhaustionCause = ResourceBudgetBreach & {
    readonly activeCases: readonly TestPlanCase['id'][];
    readonly activeWork: readonly WorkId[];
    readonly enforcement: 'post-test-diagnostic' | 'sampled';
};

type CrashCause = {
    readonly activeCases: readonly TestPlanCase['id'][];
    readonly activeWork: readonly WorkId[];
    readonly reason: 'hard-timeout';
};

export type ExecutionSupervision = {
    readonly activeCases: ReadonlyMap<string, ActiveCase>;
    readonly addActiveCase: (key: string, activeCase: ActiveCase) => void;
    readonly recordRunnerError: (error: RunnerError) => void;
    readonly removeActiveCase: (key: string) => void;
    readonly runnerErrors: readonly RunnerError[];
};

type SoftTimeoutResolution = {
    readonly failure: TestFailure;
    readonly kind: 'failure';
} | {
    readonly kind: 'milliseconds';
    readonly milliseconds: number | null;
};

type ActiveCaseInput = {
    readonly completion: CaseCompletion;
    readonly controller: AbortController;
    readonly dependencies: ExecutionSupervisionDependencies;
    readonly supervision: ExecutionSupervision;
    readonly testCase: TestPlanCase;
    readonly timeoutPolicy: ExecuteTimeoutPolicy | null | undefined;
};

type CaseBodyInput = ActiveCaseInput & {
    readonly activeCase: ActiveCase;
    readonly timeoutMilliseconds: number | null;
};

type ResourceUsageSampleInput = {
    readonly budgets: ExecuteResourceBudgets | null | undefined;
    readonly dependencies: ExecutionSupervisionDependencies;
    readonly previousSample: ResourceUsageSnapshot | null;
    readonly sample: ResourceUsageSnapshot;
    readonly supervision: ExecutionSupervision;
};

export function createExecutionSupervision(): ExecutionSupervision {
    const activeCases = new Map<string, ActiveCase>();
    const runnerErrors: RunnerError[] = [];

    return {
        activeCases,
        addActiveCase(key, activeCase) {
            activeCases.set(key, activeCase);
        },
        recordRunnerError(error) {
            runnerErrors.push(error);
        },
        removeActiveCase(key) {
            activeCases.delete(key);
        },
        runnerErrors
    };
}

function createCaseCompletion(): CaseCompletion {
    const { promise, resolve } = Promise.withResolvers<ConcurrentCase>();

    return {
        complete: resolve,
        promise
    };
}

function createTerminalCase(
    testCase: TestPlanCase,
    verdict: PerTestResult['verdict'],
    wallTimeMs: number
): ConcurrentCase {
    return {
        result: {
            id: testCase.id,
            outcome: null,
            verdict,
            workId: testCase.workId,
            wallTimeMs
        },
        runnerErrors: [],
        wallTimeMs
    };
}
function failCase(
    testCase: Pick<TestPlanCase, 'id' | 'workId'>,
    failures: TestFailures,
    wallTimeMs: number
): PerTestResult {
    const outcome = {
        failures,
        kind: 'fail'
    } as const;

    return {
        id: testCase.id,
        outcome,
        verdict: verdictFromOutcome(outcome),
        workId: testCase.workId,
        wallTimeMs
    };
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
        result: failCase(executedCase.result, [ failure ], executedCase.wallTimeMs)
    };
}

function clearTimer(wallClock: WallClock, timer: ReturnType<WallClock['setTimeout']> | null): void {
    if (timer !== null) {
        wallClock.clearTimeout(timer);
    }
}

function policyCheckedCase(
    testCase: TestPlanCase,
    executedCase: ConcurrentCase,
    supervision: ExecutionSupervision,
    dependencies: ExecutionSupervisionDependencies
): ConcurrentCase {
    const errors = dependencies.runtimePolicy?.takeCaseErrors(testCase) ?? [];

    if (errors.length === 0) {
        return executedCase;
    }

    for (const error of errors) {
        supervision.recordRunnerError(error);
    }

    return {
        ...createTerminalCase(testCase, 'runtime-policy', executedCase.wallTimeMs),
        runnerErrors: executedCase.runnerErrors
    };
}

async function runTestCaseWithPolicy(
    testCase: TestPlanCase,
    controller: AbortController,
    supervision: ExecutionSupervision,
    dependencies: ExecutionSupervisionDependencies
): Promise<ConcurrentCase> {
    const executedCase = await runTestCase(testCase, dependencies.wallClock, {
        controller,
        runtimePolicy: dependencies.runtimePolicy ?? null
    });

    return policyCheckedCase(testCase, executedCase, supervision, dependencies);
}

function activeCaseIds(activeCases: ReadonlyMap<string, ActiveCase>): readonly TestPlanCase['id'][] {
    return Array.from(activeCases.values(), function toCaseId(activeCase) {
        return activeCase.testCase.id;
    });
}

function activeWorkIds(activeCases: ReadonlyMap<string, ActiveCase>): readonly WorkId[] {
    return Array.from(activeCases.values(), function toWorkId(activeCase) {
        return activeCase.testCase.workId;
    });
}

function resourceExhaustionError(cause: ResourceExhaustionCause): RunnerError {
    const [ activeCase = null ] = cause.activeCases;
    const [ activeWork = null ] = cause.activeWork;

    return {
        attributedTo: cause.activeCases.length === 1 ? activeCase : null,
        attributedToWork: cause.activeWork.length === 1 ? activeWork : null,
        cause,
        message: `Resource budget exceeded: ${cause.metric} observed ${cause.observed}, budget ${cause.budget}.`,
        subtype: 'resource-exhaustion'
    };
}

function crashError(cause: CrashCause): RunnerError {
    const [ activeCase = null ] = cause.activeCases;
    const [ activeWork = null ] = cause.activeWork;

    return {
        attributedTo: cause.activeCases.length === 1 ? activeCase : null,
        attributedToWork: cause.activeWork.length === 1 ? activeWork : null,
        cause,
        message: 'Test execution exceeded hard timeout.',
        subtype: 'crash'
    };
}

function completeActiveCasesAs(
    supervision: ExecutionSupervision,
    verdict: PerTestResult['verdict'],
    dependencies: ExecutionSupervisionDependencies
): void {
    for (const [ key, activeCase ] of supervision.activeCases) {
        supervision.removeActiveCase(key);
        activeCase.abort();
        clearTimer(dependencies.wallClock, activeCase.hardTimeout);
        activeCase.completion.complete(createTerminalCase(
            activeCase.testCase,
            verdict,
            dependencies.wallClock.currentTimestampInMilliseconds - activeCase.startedAtMilliseconds
        ));
    }
}

function completeActiveCasesWithCrash(
    supervision: ExecutionSupervision,
    dependencies: ExecutionSupervisionDependencies
): void {
    const cause: CrashCause = {
        activeCases: activeCaseIds(supervision.activeCases),
        activeWork: activeWorkIds(supervision.activeCases),
        reason: 'hard-timeout'
    };

    if (cause.activeCases.length > 0) {
        supervision.recordRunnerError(crashError(cause));
        completeActiveCasesAs(supervision, 'crashed', dependencies);
    }
}

function completeActiveCasesWithResourceExhaustion(
    breach: ResourceBudgetBreach,
    supervision: ExecutionSupervision,
    dependencies: ExecutionSupervisionDependencies
): void {
    const cause: ResourceExhaustionCause = {
        ...breach,
        activeCases: activeCaseIds(supervision.activeCases),
        activeWork: activeWorkIds(supervision.activeCases),
        enforcement: 'sampled'
    };

    if (cause.activeCases.length === 0) {
        supervision.recordRunnerError(resourceExhaustionError({
            ...cause,
            enforcement: 'post-test-diagnostic'
        }));
        return;
    }

    supervision.recordRunnerError(resourceExhaustionError(cause));
    completeActiveCasesAs(supervision, 'resource-exhausted', dependencies);
}

async function runCaseWithSoftTimeout(
    input: CaseBodyInput
): Promise<ConcurrentCase> {
    if (input.timeoutMilliseconds === null) {
        return await runTestCaseWithPolicy(input.testCase, input.controller, input.supervision, input.dependencies);
    }

    const timing = { timedOut: false };
    const softTimeout = input.dependencies.wallClock.setTimeout(function abortTimedOutCase() {
        timing.timedOut = true;
        input.controller.abort();
    }, input.timeoutMilliseconds);
    const executedCase = await runTestCaseWithPolicy(
        input.testCase,
        input.controller,
        input.supervision,
        input.dependencies
    );

    clearTimer(input.dependencies.wallClock, softTimeout);

    if (timing.timedOut) {
        return resultWithTimeoutFailure(executedCase, input.timeoutMilliseconds, executedCase.wallTimeMs);
    }

    return executedCase;
}

function invalidTimeoutCase(testCase: TestPlanCase, failure: TestFailure): ConcurrentCase {
    return {
        result: failCase(testCase, [ failure ], 0),
        runnerErrors: [],
        wallTimeMs: 0
    };
}

function registerActiveCase(input: ActiveCaseInput): ActiveCase {
    const key = workIdentityKey(input.testCase.workId);
    const startedAtMilliseconds = input.dependencies.wallClock.currentTimestampInMilliseconds;
    const hardTimeout = input.timeoutPolicy === null || input.timeoutPolicy === undefined
        ? null
        : input.dependencies.wallClock.setTimeout(function hardTimeoutActiveCases() {
            completeActiveCasesWithCrash(input.supervision, input.dependencies);
        }, input.timeoutPolicy.hardTimeoutMilliseconds);
    const activeCase: ActiveCase = {
        abort() {
            input.controller.abort();
        },
        completion: input.completion,
        hardTimeout,
        startedAtMilliseconds,
        testCase: input.testCase
    };

    input.supervision.addActiveCase(key, activeCase);

    return activeCase;
}

function completeFinishedActiveCase(input: CaseBodyInput, executedCase: ConcurrentCase): void {
    const key = workIdentityKey(input.testCase.workId);

    if (input.supervision.activeCases.get(key) === input.activeCase) {
        input.supervision.removeActiveCase(key);
        clearTimer(input.dependencies.wallClock, input.activeCase.hardTimeout);
        input.completion.complete(executedCase);
    }
}

function createInconclusiveCaseResult(testCase: TestPlanCase, error: unknown, wallTimeMs: number): PerTestResult {
    const reason = error instanceof Error ? error.message : 'Unknown test execution error.';
    const outcome = {
        kind: 'inconclusive',
        reason: `Test execution failed before producing a result: ${reason}`
    } as const;

    return {
        id: testCase.id,
        outcome,
        verdict: verdictFromOutcome(outcome),
        workId: testCase.workId,
        wallTimeMs
    };
}
function completeUnexpectedBodyError(input: CaseBodyInput, error: unknown): void {
    const wallTimeMs = input.dependencies.wallClock.currentTimestampInMilliseconds -
        input.activeCase.startedAtMilliseconds;

    completeFinishedActiveCase(input, {
        result: createInconclusiveCaseResult(input.testCase, error, wallTimeMs),
        runnerErrors: [],
        wallTimeMs
    });
}
async function runCaseBodyUnderSupervision(input: CaseBodyInput): Promise<ConcurrentCase> {
    try {
        const executedCase = await Promise.race([
            runCaseWithSoftTimeout(input),
            input.completion.promise
        ]);
        completeFinishedActiveCase(input, executedCase);
        return executedCase;
    } catch (error: unknown) {
        const wallTimeMs = input.dependencies.wallClock.currentTimestampInMilliseconds -
            input.activeCase.startedAtMilliseconds;
        const fallbackCase = {
            result: createInconclusiveCaseResult(input.testCase, error, wallTimeMs),
            runnerErrors: [],
            wallTimeMs
        };

        completeUnexpectedBodyError(input, error);
        return fallbackCase;
    }
}

function createCaseBodyInput(
    input: ActiveCaseInput,
    activeCase: ActiveCase,
    timeoutMilliseconds: number | null
): CaseBodyInput {
    return {
        ...input,
        activeCase,
        timeoutMilliseconds
    };
}

function registerCaseBodyInput(input: ActiveCaseInput, timeoutMilliseconds: number | null): CaseBodyInput {
    return createCaseBodyInput(input, registerActiveCase(input), timeoutMilliseconds);
}

function createActiveCaseInput(
    testCase: TestPlanCase,
    timeoutPolicy: ExecuteTimeoutPolicy | null | undefined,
    supervision: ExecutionSupervision,
    dependencies: ExecutionSupervisionDependencies
): ActiveCaseInput {
    return {
        completion: createCaseCompletion(),
        controller: new AbortController(),
        dependencies,
        supervision,
        testCase,
        timeoutPolicy
    };
}

export function recordResourceUsageSample(input: ResourceUsageSampleInput): boolean {
    const breach = findResourceBudgetBreach(input.budgets, input.sample, input.previousSample);

    if (breach === null) {
        return false;
    }

    completeActiveCasesWithResourceExhaustion(breach, input.supervision, input.dependencies);

    return true;
}

export async function executeCaseBody(
    testCase: TestPlanCase,
    timeoutPolicy: ExecuteTimeoutPolicy | null | undefined,
    supervision: ExecutionSupervision,
    dependencies: ExecutionSupervisionDependencies
): Promise<ConcurrentCase> {
    if (testCase.execution.kind === 'skip') {
        return await runTestCase(testCase, dependencies.wallClock);
    }

    const timeoutResolution = resolveSoftTimeout(testCase, timeoutPolicy);

    if (timeoutResolution.kind === 'failure') {
        return invalidTimeoutCase(testCase, timeoutResolution.failure);
    }

    return await runCaseBodyUnderSupervision(registerCaseBodyInput(
        createActiveCaseInput(testCase, timeoutPolicy, supervision, dependencies),
        timeoutResolution.milliseconds
    ));
}
