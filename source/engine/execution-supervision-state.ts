import { AsyncLocalStorage } from 'node:async_hooks';
import type { Clock } from '@enormora/clock';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { withRunnerInfrastructure } from './execution-observation.ts';
import { currentCaseExecutionLifecycle, type CaseExecutionLifecycle } from './case-execution-lifecycle.ts';
import type { PerTestResult, RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';
import type { AttemptId } from './identity.ts';
import type { BenchmarkExecutionResult } from './benchmark-result.ts';
import type { ExecutedCase } from './case-interruption.ts';

export function scheduleSupervisionTimeout(
    wallClock: Clock,
    callback: () => void,
    milliseconds: number
): ReturnType<Clock['setTimeout']> {
    const ownedCallback = AsyncLocalStorage.bind(callback);
    return withRunnerInfrastructure(function scheduleWatchdog() {
        return wallClock.setTimeout(ownedCallback, milliseconds);
    });
}

export type BenchmarkState = StoredValue<BenchmarkExecutionResult | null>;
export function createBenchmarkState(): BenchmarkState {
    return createStoredValue<BenchmarkExecutionResult | null>(null);
}

export type ExecutionConcurrentCase = ExecutedCase;

export type CaseCompletion = {
    readonly complete: (executedCase: ExecutionConcurrentCase) => void;
    readonly promise: Promise<ExecutionConcurrentCase>;
};

export function createCaseCompletion(): CaseCompletion {
    const { promise, resolve } = Promise.withResolvers<ExecutionConcurrentCase>();
    return { complete: resolve, promise };
}

export type ActiveCase = {
    readonly benchmark: BenchmarkState;
    readonly attempt: AttemptId;
    readonly abort: () => void;
    readonly completion: CaseCompletion;
    readonly hardTimeout: ReturnType<Clock['setTimeout']> | null;
    readonly startedAtMicroseconds: number;
    readonly testCase: TestPlanCase;
};

export type ExecutionSupervision = {
    readonly lifecycle: CaseExecutionLifecycle | null;
    readonly acceptsNewCases: () => boolean;
    readonly closedBoundaryVerdict: () => PerTestResult['verdict'];
    readonly hasTerminalError: () => boolean;
    readonly activeCases: ReadonlyMap<string, ActiveCase>;
    readonly addActiveCase: (key: string, activeCase: ActiveCase) => void;
    readonly recordRunnerError: (error: RunnerError) => void;
    readonly removeActiveCase: (key: string) => void;
    readonly runnerErrors: readonly RunnerError[];
    readonly stopAcceptingCases: () => void;
};

export function createExecutionSupervision(): ExecutionSupervision {
    const activeCases = new Map<string, ActiveCase>();
    const runnerErrors: ExecutionSupervision['runnerErrors'][number][] = [];
    let acceptsNewCases = true;

    return {
        lifecycle: currentCaseExecutionLifecycle(),
        acceptsNewCases() {
            return acceptsNewCases;
        },
        closedBoundaryVerdict() {
            const exhausted = runnerErrors.some(function processExhausted(error) {
                return error.subtype === 'process-exhaustion';
            });
            return exhausted ? 'process-exhausted' : 'crashed';
        },
        hasTerminalError() {
            return runnerErrors.some(function terminalError(error) {
                return error.subtype === 'crash' || error.subtype === 'process-exhaustion';
            });
        },
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
        runnerErrors,
        stopAcceptingCases() {
            acceptsNewCases = false;
        }
    };
}
