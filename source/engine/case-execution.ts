import type { Clock } from '@enormora/clock';
import { runCaseBody } from './case-body.ts';
import type { CaseExecutionOptions } from './case-execution-context.ts';
import type { ExecutedBody } from './body-result.ts';
import { createBenchmarkAttempt } from './benchmark-attempt.ts';
import { createBodyOutcome } from './body-outcome.ts';
import { createAssertionRecorder, type AssertionRecorder } from './assertion-recorder.ts';
import {
    singleAttemptResult,
    type PerTestResult,
    type ExecutedCase,
    type TestContractFailure,
    type TestFailure,
    type TestOutcome,
    verdictFromOutcome
} from './run-result.ts';
import { createCaseInterruption } from './case-interruption.ts';
import type { TestPlanCase, TestPlanCaseExecution } from './test-plan.ts';

export type RunTestCaseOptions = CaseExecutionOptions & {
    readonly interruption: Promise<ExecutedCase> | null;
    readonly assertionRecorder: AssertionRecorder | null;
};

function defaultRunTestCaseOptions(): RunTestCaseOptions {
    const controller = new AbortController();

    return {
        seed: 0n,
        async onPropertyUpdate() {
            return undefined;
        },
        async onBenchmarkUpdate() {
            return undefined;
        },
        propertyRun: { seed: 0n, projectRoot: null },
        benchmarkEnvironment: null,
        attempt: { index: 0 },
        controller,
        runtimePolicy: null,
        interruption: null,
        assertionRecorder: null
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

function completedTerminalOutcome(
    outcome: TestOutcome | null,
    terminal: PerTestResult,
    hasLateFailures: boolean
): Pick<PerTestResult, 'outcome' | 'verdict'> {
    if (outcome === null || outcome.kind === 'pass') {
        return { outcome: terminal.outcome, verdict: terminal.verdict };
    }
    return { outcome, verdict: hasLateFailures ? terminal.verdict : verdictFromOutcome(outcome) };
}

function completedCaseOutcome(
    recorder: AssertionRecorder,
    body: ExecutedBody,
    terminal: ExecutedCase | null,
    generated: boolean
): Pick<PerTestResult, 'outcome' | 'verdict'> {
    const outcome = createBodyOutcome(recorder, body, terminal !== null || generated);
    if (terminal === null) {
        return { outcome, verdict: outcome === null ? 'runtime-policy' : verdictFromOutcome(outcome) };
    }
    return completedTerminalOutcome(outcome, terminal.result, recorder.lateFailures().length > 0);
}

function caseBodyMode(execution: TestPlanCaseExecution): string {
    if (execution.kind !== 'body') {
        throw new TypeError('Referenced body was not admitted before case execution.');
    }
    return execution.bodyMode;
}

export function createCaseAssertionRecorder(
    testCase: TestPlanCase,
    attempt: RunTestCaseOptions['attempt']
): AssertionRecorder {
    return createAssertionRecorder({ case: testCase.id, work: testCase.workId, attempt, trial: null });
}

export async function withCaseAssertionRecorder<Value>(
    testCase: TestPlanCase,
    attempt: RunTestCaseOptions['attempt'],
    recorder: AssertionRecorder | null,
    run: (active: AssertionRecorder) => Promise<Value>
): Promise<Value> {
    if (recorder !== null) {
        return await run(recorder);
    }
    const owned = createCaseAssertionRecorder(testCase, attempt);
    try {
        return await run(owned);
    } finally {
        owned.close('settled');
        owned.publish();
    }
}

async function executeTestBody(
    testCase: TestPlanCase,
    options: RunTestCaseOptions,
    recorder: AssertionRecorder,
    elapsed: () => number
): Promise<ExecutedCase> {
    const execution = {
        recorder,
        benchmark: createBenchmarkAttempt(testCase, options.onBenchmarkUpdate, options.benchmarkEnvironment),
        interruption: createCaseInterruption(options.interruption, recorder)
    };
    const completed = await runCaseBody(testCase, execution.recorder, {
        ...options,
        interruption: execution.interruption
    }, execution.benchmark);
    recorder.close('settled');
    const executedBody = { ...completed, runnerErrors: [ ...completed.runnerErrors, ...execution.benchmark.errors() ] };
    const completion = completedCaseOutcome(
        execution.recorder,
        executedBody,
        execution.interruption.result(),
        caseBodyMode(testCase.execution) === 'benchmark'
    );
    const durationMicroseconds = elapsed();

    return {
        result: singleAttemptResult({
            property: caseBodyMode(testCase.execution) === 'property'
                ? { invocations: execution.recorder.propertyEvidence() }
                : null,
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

    return await withCaseAssertionRecorder(
        testCase,
        options.attempt,
        options.assertionRecorder,
        async function run(recorder) {
            return await executeTestBody(testCase, options, recorder, function measureExecution() {
                return Number(wallClock.currentMonotonicMicroseconds) - startedAtMicroseconds;
            });
        }
    );
}
