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
    type TestContractFailure,
    type TestFailure,
    type TestOutcome,
    verdictFromOutcome
} from './run-result.ts';
import { createCaseInterruption, type ExecutedCase } from './case-interruption.ts';
import type { TestPlanCase } from './test-plan.ts';

export type RunTestCaseOptions = CaseExecutionOptions & {
    readonly interruption: Promise<ExecutedCase> | null;
};

function defaultRunTestCaseOptions(): RunTestCaseOptions {
    const controller = new AbortController();

    return {
        async onBenchmarkUpdate() {
            return undefined;
        },
        propertyRun: { seed: 0n, projectRoot: null },
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
    const outcome = createBodyOutcome(recorder, body, terminal !== null || generated);
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
