import { AsyncLocalStorage } from 'node:async_hooks';
import type { Clock } from '@enormora/clock';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { createBoundaryFailureArtifact, type BoundaryFailure } from './run-artifact.ts';
import {
    boundaryArtifacts,
    currentProcessUsageSamplingInterval,
    recordBoundaryArtifact,
    withRunnerInfrastructure
} from './execution-observation.ts';
import { currentCaseExecutionLifecycle, type CaseExecutionLifecycle } from './case-execution-lifecycle.ts';
import type { PerTestResult, RunnerError } from './run-result.ts';
import type { TestPlanCase } from './test-plan.ts';
import type { AttemptId, WorkId } from './identity.ts';
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

export function clearSupervisionTimeout(wallClock: Clock, timer: ReturnType<Clock['setTimeout']> | null): void {
    if (timer !== null) {
        wallClock.clearTimeout(timer);
    }
}

export type BenchmarkState = StoredValue<PerTestResult['benchmark']>;
export function createBenchmarkState(): BenchmarkState {
    return createStoredValue<PerTestResult['benchmark']>(null);
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
    readonly cancel: () => void;
    readonly wasCancelled: () => boolean;
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
    let cancelled = false;

    return {
        cancel() {
            cancelled = true;
            acceptsNewCases = false;
            for (const active of activeCases.values()) {
                active.abort();
            }
        },
        wasCancelled() {
            return cancelled;
        },
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

export function recordNativeBoundaryFailure(
    failure: BoundaryFailure,
    supervision: ExecutionSupervision,
    wallClock: Clock
): void {
    const timestamp = new Date(wallClock.currentUnixEpochMilliseconds);
    const metadata = {
        timestamp: timestamp.toISOString(),
        workerId: String(process.pid),
        nodeVersion: process.version,
        source: 'native' as const
    };
    const evidence = failure.kind === 'process-exhaustion'
        ? { ...failure, processUsageSamplingIntervalMilliseconds: currentProcessUsageSamplingInterval() }
        : failure;
    recordBoundaryArtifact(
        createBoundaryFailureArtifact(
            evidence,
            metadata,
            Array.from(
                supervision
                    .activeCases
                    .values(),
                function activeWork(active) {
                    return { work: active.testCase.workId, attempt: active.attempt };
                }
            ),
            boundaryArtifacts().length
        )
    );
}

export type CrashCause = {
    readonly activeAttempts: readonly AttemptId[];
    readonly activeCases: readonly TestPlanCase['id'][];
    readonly activeWork: readonly WorkId[];
    readonly reason: 'hard-timeout';
    readonly termination: 'hard-timeout';
};

function soleActiveAttempt(attempts: readonly AttemptId[]): AttemptId | null {
    return attempts.length === 1 ? attempts[0] ?? null : null;
}

export function crashError(cause: CrashCause): RunnerError {
    const [ activeCase = null ] = cause.activeCases;
    const [ activeWork = null ] = cause.activeWork;

    return {
        attributedToAttempt: soleActiveAttempt(cause.activeAttempts),
        attributedTo: cause.activeCases.length === 1 ? activeCase : null,
        attributedToWork: cause.activeWork.length === 1 ? activeWork : null,
        cause,
        diagnostics: [ { label: 'reason', value: cause.reason } ],
        message: 'Test execution exceeded hard timeout.',
        subtype: 'crash'
    };
}
