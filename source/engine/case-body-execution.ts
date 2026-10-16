import { readTestBodyFamily } from './test-body.ts';
import type { BenchmarkExecutionResult } from './benchmark-result.ts';
import type { CaseRunnerError, RunnerError } from './run-result.ts';
import type { TestBody } from './test-node.ts';
import type { TestPlanCase } from './test-plan.ts';

export type BenchmarkAttempt = {
    readonly result: () => BenchmarkExecutionResult | null;
    readonly errors: () => readonly RunnerError[];
    readonly updateResult: (result: BenchmarkExecutionResult) => Promise<void>;
    readonly reportError: (error: CaseRunnerError) => void;
};

export function createBenchmarkAttempt(
    testCase: TestPlanCase,
    onUpdate: BenchmarkAttempt['updateResult']
): BenchmarkAttempt {
    let result: BenchmarkExecutionResult | null = null;
    const errors: RunnerError[] = [];
    return {
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

export function builderBodyForAttempt(testCase: TestPlanCase, attempt: BenchmarkAttempt): TestBody {
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
