import type { WallClock } from '@enormora/wall-clock';
import { invalidTimeoutMetadataFailure, runTestCase, timeoutFailure } from './case-execution.ts';
import { caseIdentityKey } from './identity.ts';
import {
    verdictFromOutcome,
    type PerTestResult,
    type ResourceUsageSnapshot,
    type RunnerError,
    type TestFailure
} from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

export type ExecuteTimeoutPolicy = {
    readonly hardTimeoutMilliseconds: number;
    readonly timeoutMilliseconds: number;
};

export type ExecuteResourceBudgets = {
    readonly activeResourceCount: number | null;
    readonly javaScriptEngineHeapBytes: number | null;
    readonly residentSetBytes: number | null;
    readonly residentSetGrowthBytesPerSecond: number | null;
};

export type ConcurrentCase = {
    readonly result: PerTestResult;
    readonly wallTimeMs: number;
};

export type ExecutionSupervisionDependencies = {
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

type ResourceBudgetMetric = keyof ExecuteResourceBudgets;

type ResourceBudgetBreach = {
    readonly budget: number;
    readonly metric: ResourceBudgetMetric;
    readonly observed: number;
    readonly sample: ResourceUsageSnapshot;
};

type ResourceExhaustionCause = ResourceBudgetBreach & {
    readonly activeCases: readonly TestPlanCase['id'][];
    readonly enforcement: 'post-test-diagnostic' | 'sampled';
};

type CrashCause = {
    readonly activeCases: readonly TestPlanCase['id'][];
    readonly reason: 'hard-timeout';
};

export type ExecutionSupervision = {
    readonly activeCases: ReadonlyMap<string, ActiveCase>;
    readonly addActiveCase: (key: string, activeCase: ActiveCase) => void;
    readonly recordRunnerError: (error: RunnerError) => void;
    readonly removeActiveCase: (key: string) => void;
    readonly runnerErrors: readonly RunnerError[];
};

type SoftTimeoutResolution =
    | { readonly failure: TestFailure; readonly kind: 'failure'; }
    | { readonly kind: 'milliseconds'; readonly milliseconds: number | null; };

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

const millisecondsPerSecond = 1000;
const resourceBudgetMetrics: readonly ResourceBudgetMetric[] = [
    'activeResourceCount',
    'javaScriptEngineHeapBytes',
    'residentSetBytes',
    'residentSetGrowthBytesPerSecond'
];

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
            verdict
        },
        wallTimeMs
    };
}

function failCase(id: TestPlanCase['id'], failures: readonly [TestFailure, ...TestFailure[]]): PerTestResult {
    const outcome = {
        failures,
        kind: 'fail'
    } as const;

    return {
        id,
        outcome,
        verdict: verdictFromOutcome(outcome)
    };
}

function timeoutMetadataValue(testCase: TestPlanCase): unknown {
    return testCase.metadata.timeoutMilliseconds;
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

    const metadataTimeout = timeoutMetadataValue(testCase);

    if (metadataTimeout === undefined) {
        return { kind: 'milliseconds', milliseconds: policy.timeoutMilliseconds };
    }

    if (isPositiveSafeInteger(metadataTimeout) && metadataTimeout <= policy.hardTimeoutMilliseconds) {
        return { kind: 'milliseconds', milliseconds: metadataTimeout };
    }

    return {
        failure: invalidTimeoutMetadataFailure(
            metadataTimeout,
            `positive safe integer <= ${policy.hardTimeoutMilliseconds}`
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
        result: failCase(executedCase.result.id, [ failure ])
    };
}

function clearTimer(wallClock: WallClock, timer: ReturnType<WallClock['setTimeout']> | null): void {
    if (timer !== null) {
        wallClock.clearTimeout(timer);
    }
}

function activeCaseIds(activeCases: ReadonlyMap<string, ActiveCase>): readonly TestPlanCase['id'][] {
    return Array.from(activeCases.values(), function toCaseId(activeCase) {
        return activeCase.testCase.id;
    });
}

function resourceExhaustionError(cause: ResourceExhaustionCause): RunnerError {
    return {
        attributedTo: cause.activeCases.length === 1 ? cause.activeCases[0] ?? null : null,
        cause,
        message: `Resource budget exceeded: ${cause.metric} observed ${cause.observed}, budget ${cause.budget}.`,
        subtype: 'resource-exhaustion'
    };
}

function crashError(cause: CrashCause): RunnerError {
    return {
        attributedTo: cause.activeCases.length === 1 ? cause.activeCases[0] ?? null : null,
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
    testCase: TestPlanCase,
    controller: AbortController,
    timeoutMilliseconds: number | null,
    dependencies: ExecutionSupervisionDependencies
): Promise<ConcurrentCase> {
    if (timeoutMilliseconds === null) {
        return await runTestCase(testCase, dependencies.wallClock, { signal: controller.signal });
    }

    let timedOut = false;
    const softTimeout = dependencies.wallClock.setTimeout(function abortTimedOutCase() {
        timedOut = true;
        controller.abort();
    }, timeoutMilliseconds);
    const executedCase = await runTestCase(testCase, dependencies.wallClock, { signal: controller.signal });

    clearTimer(dependencies.wallClock, softTimeout);

    if (timedOut) {
        return resultWithTimeoutFailure(executedCase, timeoutMilliseconds, executedCase.wallTimeMs);
    }

    return executedCase;
}

function invalidTimeoutCase(testCase: TestPlanCase, failure: TestFailure): ConcurrentCase {
    return {
        result: failCase(testCase.id, [ failure ]),
        wallTimeMs: 0
    };
}

function registerActiveCase(input: ActiveCaseInput): ActiveCase {
    const key = caseIdentityKey(input.testCase.id);
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
    const key = caseIdentityKey(input.testCase.id);

    if (input.supervision.activeCases.get(key) === input.activeCase) {
        input.supervision.removeActiveCase(key);
        clearTimer(input.dependencies.wallClock, input.activeCase.hardTimeout);
        input.completion.complete(executedCase);
    }
}

function createInconclusiveCaseResult(testCase: TestPlanCase, error: unknown): PerTestResult {
    const reason = error instanceof Error ? error.message : 'Unknown test execution error.';
    const outcome = {
        kind: 'inconclusive',
        reason: `Test execution failed before producing a result: ${reason}`
    } as const;

    return {
        id: testCase.id,
        outcome,
        verdict: verdictFromOutcome(outcome)
    };
}

function completeUnexpectedBodyError(input: CaseBodyInput, error: unknown): void {
    completeFinishedActiveCase(input, {
        result: createInconclusiveCaseResult(input.testCase, error),
        wallTimeMs: input.dependencies.wallClock.currentTimestampInMilliseconds -
            input.activeCase.startedAtMilliseconds
    });
}

async function runCaseBodyUnderSupervision(input: CaseBodyInput): Promise<ConcurrentCase> {
    try {
        const executedCase = await Promise.race([
            runCaseWithSoftTimeout(
                input.testCase,
                input.controller,
                input.timeoutMilliseconds,
                input.dependencies
            ),
            input.completion.promise
        ]);
        completeFinishedActiveCase(input, executedCase);

        return executedCase;
    } catch (error: unknown) {
        const fallbackCase = {
            result: createInconclusiveCaseResult(input.testCase, error),
            wallTimeMs: input.dependencies.wallClock.currentTimestampInMilliseconds -
                input.activeCase.startedAtMilliseconds
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

function observedGrowthBytesPerSecond(
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): number {
    if (previousSample === null) {
        return 0;
    }

    const elapsedMilliseconds = sample.capturedAtMilliseconds - previousSample.capturedAtMilliseconds;

    if (elapsedMilliseconds <= 0) {
        return 0;
    }

    return Math.max(
        0,
        (sample.residentSetBytes - previousSample.residentSetBytes) * millisecondsPerSecond / elapsedMilliseconds
    );
}

function observedBudgetValue(
    metric: ResourceBudgetMetric,
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): number {
    const observedValues = {
        activeResourceCount: sample.activeResourceCount,
        javaScriptEngineHeapBytes: sample.javaScriptEngineHeapBytes,
        residentSetBytes: sample.residentSetBytes,
        residentSetGrowthBytesPerSecond: observedGrowthBytesPerSecond(sample, previousSample)
    };

    return observedValues[metric];
}

function findResourceBudgetBreach(
    budgets: ExecuteResourceBudgets | null | undefined,
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): ResourceBudgetBreach | null {
    if (budgets === null || budgets === undefined) {
        return null;
    }

    for (const metric of resourceBudgetMetrics) {
        const budget = budgets[metric];
        const observed = observedBudgetValue(metric, sample, previousSample);

        if (budget !== null && observed > budget) {
            return { budget, metric, observed, sample };
        }
    }

    return null;
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
    const timeoutResolution = resolveSoftTimeout(testCase, timeoutPolicy);

    if (timeoutResolution.kind === 'failure') {
        return invalidTimeoutCase(testCase, timeoutResolution.failure);
    }

    return await runCaseBodyUnderSupervision(registerCaseBodyInput(
        createActiveCaseInput(testCase, timeoutPolicy, supervision, dependencies),
        timeoutResolution.milliseconds
    ));
}
