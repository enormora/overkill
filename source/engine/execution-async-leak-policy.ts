import { observeCaseResourceOwners } from './resource-owner-observation.ts';
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
    readonly readResourceBaseline: () => readonly string[];
    readonly ambiguousResources: () => readonly string[];
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

export function hasCasePolicyErrors(errors: readonly RunnerError[]): boolean {
    return errors.some(function caseOwned(error) {
        return error.attributedTo !== null;
    });
}

function runtimePolicyCase(executedCase: ConcurrentCase): ConcurrentCase {
    return {
        result: { ...executedCase.result, outcome: null, verdict: 'runtime-policy' },
        runnerErrors: executedCase.runnerErrors,
        durationMicroseconds: executedCase.durationMicroseconds
    };
}

function hasPromiseTrackingContractFailure(executedCase: ConcurrentCase): boolean {
    const { outcome } = executedCase.result;

    return outcome?.kind === 'fail' && outcome.failures.some(function promiseTrackingFailure(failure) {
        return failure.kind === 'test-contract' && promiseTrackingContractFailureCodes.has(failure.code);
    });
}

function caseActiveResourceLeak(input: CaseAsyncLeakPolicyInput): RunnerError | null {
    if (!input.includeActiveResourceLeaks) {
        return null;
    }
    const attribution = input.ambiguousResources().length > 0
        ? { attributedTo: null, attributedToWork: null, phase: 'run' as const }
        : { attributedTo: input.testCase.id, attributedToWork: input.testCase.workId, phase: 'body' as const };
    return activeResourceLeakError({
        ...attribution,
        after: input.dependencies.readActiveResourceTypes(),
        before: input.readResourceBaseline()
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
    const activeLeakError = caseActiveResourceLeak(input);
    const runnerErrors = [ promiseLeakError, activeLeakError ].filter(function isRunnerError(
        error
    ): error is RunnerError {
        return error !== null;
    });

    return {
        executedCase: hasCasePolicyErrors(runnerErrors)
            ? runtimePolicyCase(input.executedCase)
            : input.executedCase,
        runnerErrors
    };
}

type CaseCompletionInput = {
    readonly dependencies: AsyncLeakDependencies;
    readonly includeActiveResourceLeaks: boolean;
    readonly testCase: TestPlanCase;
    readonly complete: () => Promise<readonly RunnerError[]>;
};

export async function completeCaseWithAsyncLeakPolicy(input: CaseCompletionInput): Promise<readonly RunnerError[]> {
    const observed = await observeCaseResourceOwners(input.dependencies.readActiveResourceTypes, input.complete);
    await settleAsyncWork();
    const leak = input.includeActiveResourceLeaks
        ? activeResourceLeakError({
            after: input.dependencies.readActiveResourceTypes(),
            before: observed.baseline,
            attributedTo: observed.ambiguousResources.length === 0 ? input.testCase.id : null,
            attributedToWork: observed.ambiguousResources.length === 0 ? input.testCase.workId : null,
            phase: observed.ambiguousResources.length === 0 ? 'body' : 'run'
        })
        : null;
    return leak === null ? observed.result : [ ...observed.result, leak ];
}

export async function observeConcurrentResourceLeaks<Value>(
    dependencies: AsyncLeakDependencies,
    execute: () => Promise<Value>
): Promise<{ readonly result: Value; readonly runnerError: RunnerError | null; }> {
    const observed = await observeCaseResourceOwners(dependencies.readActiveResourceTypes, execute);
    await settleAsyncWork();
    return {
        result: observed.result,
        runnerError: activeResourceLeakError({
            after: dependencies.readActiveResourceTypes(),
            before: observed.baseline,
            attributedTo: null,
            attributedToWork: null,
            phase: 'run'
        })
    };
}
