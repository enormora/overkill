import {
    activeResourceLeakError,
    createAsyncLeakMonitor,
    createDisabledAsyncLeakMonitor,
    type AsyncLeakMonitor
} from './async-leak-diagnostics.ts';
import { settleAsyncWork } from './async-control.ts';
import type { ConcurrentCase } from './execution-supervision.ts';
import type { RunnerError, TestContractFailure } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';

export type AsyncLeakDiagnostics = 'disabled' | 'enabled';

export type AsyncLeakDependencies = {
    readonly asyncLeakMonitor: AsyncLeakMonitor;
    readonly readActiveResourceTypes: () => readonly string[];
};

export type AsyncLeakCheckedCase = {
    readonly executedCase: ConcurrentCase;
    readonly runnerErrors: readonly RunnerError[];
};

export type CaseAsyncLeakPolicyInput = {
    readonly activeResourceTypesBefore: readonly string[];
    readonly dependencies: AsyncLeakDependencies;
    readonly executedCase: ConcurrentCase;
    readonly includeActiveResourceLeaks: boolean;
    readonly testCase: TestPlanCase;
};

const promiseTrackingContractFailureCodes = new Set<TestContractFailure['code']>([
    'pending-async-assertion',
    'pending-in-flight-task',
    'unobserved-in-flight-task'
]);

export function createExecutionAsyncLeakMonitor(diagnostics: AsyncLeakDiagnostics): AsyncLeakMonitor {
    return diagnostics === 'enabled'
        ? createAsyncLeakMonitor()
        : createDisabledAsyncLeakMonitor();
}

function runtimePolicyCase(testCase: TestPlanCase, executedCase: ConcurrentCase): ConcurrentCase {
    return {
        result: {
            id: testCase.id,
            outcome: null,
            verdict: 'runtime-policy'
        },
        wallTimeMs: executedCase.wallTimeMs
    };
}

function hasPromiseTrackingContractFailure(executedCase: ConcurrentCase): boolean {
    const { outcome } = executedCase.result;

    return outcome?.kind === 'fail' && outcome.failures.some(function promiseTrackingFailure(failure) {
        return failure.kind === 'test-contract' && promiseTrackingContractFailureCodes.has(failure.code);
    });
}

export async function caseWithAsyncLeakPolicy(input: CaseAsyncLeakPolicyInput): Promise<AsyncLeakCheckedCase> {
    if (input.executedCase.result.outcome === null) {
        return {
            executedCase: input.executedCase,
            runnerErrors: []
        };
    }

    await settleAsyncWork();

    const promiseLeakError = hasPromiseTrackingContractFailure(input.executedCase)
        ? null
        : input.dependencies.asyncLeakMonitor.casePromiseLeakError(input.testCase);
    const activeLeakError = input.includeActiveResourceLeaks
        ? activeResourceLeakError(
            input.testCase.id,
            input.activeResourceTypesBefore,
            input.dependencies.readActiveResourceTypes(),
            'body'
        )
        : null;
    const runnerErrors = [ promiseLeakError, activeLeakError ].filter(function isRunnerError(
        error
    ): error is RunnerError {
        return error !== null;
    });

    return {
        executedCase: runnerErrors.length === 0
            ? input.executedCase
            : runtimePolicyCase(input.testCase, input.executedCase),
        runnerErrors
    };
}

export function concurrentRunActiveResourceLeak(
    dependencies: AsyncLeakDependencies,
    activeResourceTypesBefore: readonly string[]
): RunnerError | null {
    return activeResourceLeakError(
        null,
        activeResourceTypesBefore,
        dependencies.readActiveResourceTypes(),
        'run'
    );
}
