import type { BenchmarkExecutionEnvironment } from './benchmark-environment.ts';
import type { BenchmarkExecutionResult } from './benchmark-result.ts';
import type { CaseRunnerError, RunnerError } from './run-result.ts';
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
