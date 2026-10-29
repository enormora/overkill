import type { NormalizedConfig, MaxConcurrency, ProfileConfig, Scheduling } from '../config/types.ts';
import { runWithWorkerAttachments as executeWorkerAttachments } from './attachment-worker-context.ts';
import type { TestRuntimePolicy, RunResult, TestPlanCase, ReporterDispatcher } from './run-engine-primitives.ts';
import { finalizeRuntimeAttachments } from './attachment-coordinator-context.ts';
import {
    createResourceLifecycleRuntimePolicy,
    type ManagedResourceLifecycleTiming
} from './resource-lifecycle.ts';
import {
    createPermissionDenialRuntimePolicy,
    createRuntimeCapabilityPolicy,
    withRuntimePolicy
} from './capability-policy.ts';
import type { RunCommand, RunEngineFacts, RunRequest, ResolvedRun } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import { withBenchmarkRunMetadata, withBenchmarkErrorMetadata } from './benchmark-report-metadata.ts';

import {
    readDurationHistoryIndex,
    resultWithUpdatedDurationHistoryAndTiming,
    type DurationHistoryTimingMeasurement
} from './duration-history.ts';

export type RunResultSession = {
    readonly finalize: (result: RunResult) => Promise<RunResult>;
    readonly reporterDispatcher: ReporterDispatcher;
};

export type RunRuntimePolicy = TestRuntimePolicy;
type RunEngineSelection = RunCommand['engine'];

type ConcurrentEngineExecution = {
    readonly maxConcurrency: MaxConcurrency;
    readonly mode: 'concurrent-in-process';
};
type SerialEngineExecution = { readonly mode: 'serial-in-process'; };
type EngineExecution = ConcurrentEngineExecution | SerialEngineExecution;

export function engineExecution(
    scheduling: Scheduling,
    maxConcurrency: MaxConcurrency
): EngineExecution {
    return scheduling === 'concurrent'
        ? { maxConcurrency, mode: 'concurrent-in-process' as const }
        : { mode: 'serial-in-process' as const };
}

export type ResolvedRunResultFinalizer = (resolvedRun: ResolvedRun, result: RunResult) => Promise<RunResult>;

export const createRunPermissionRuntimePolicy: () => TestRuntimePolicy = createPermissionDenialRuntimePolicy;

export async function readRunDurationHistory(
    dependencies: RunOrchestratorDependencies,
    projectRoot: string,
    runtimeStateDir: string
): ReturnType<typeof readDurationHistoryIndex> {
    return await readDurationHistoryIndex(dependencies.runtimeStateStore, projectRoot, runtimeStateDir);
}

export async function finalizeResultWithDurationHistory(
    dependencies: RunOrchestratorDependencies,
    resolvedRun: ResolvedRun,
    result: RunResult,
    timing: DurationHistoryTimingMeasurement | null = null
): Promise<RunResult> {
    let attachmentResult = await finalizeRuntimeAttachments(result);
    if (resolvedRun.facts.execution.testFamily === 'benchmark') {
        attachmentResult = withBenchmarkRunMetadata(
            attachmentResult,
            resolvedRun.facts,
            Number(dependencies.wallClock.currentMonotonicMicroseconds)
        );
    }
    return await resultWithUpdatedDurationHistoryAndTiming({
        createHistoryStorage: dependencies.createHistoryStorage,
        completedAtMilliseconds: dependencies.wallClock.currentUnixEpochMilliseconds,
        resolvedRun,
        result: attachmentResult,
        store: dependencies.runtimeStateStore,
        timing
    });
}

export function composeRunRuntimePolicies(
    firstPolicy: TestRuntimePolicy | null,
    secondPolicy: TestRuntimePolicy | null
): TestRuntimePolicy | null {
    if (firstPolicy === null) {
        return secondPolicy;
    }

    if (secondPolicy === null) {
        return firstPolicy;
    }

    return {
        async prepareAttempt(testCase, attempt) {
            await secondPolicy.prepareAttempt(testCase, attempt);
            await firstPolicy.prepareAttempt(testCase, attempt);
        },
        async completeCase(testCase, attempt) {
            try {
                await secondPolicy.completeCase(testCase, attempt);
            } finally {
                await firstPolicy.completeCase(testCase, attempt);
            }
        },
        async runAttempt(testCase, attempt, run) {
            return await firstPolicy.runAttempt(testCase, attempt, async function runSecondPolicy() {
                return await secondPolicy.runAttempt(testCase, attempt, run);
            });
        },
        async runLoad<Value>(run: () => Promise<Value>): Promise<Value> {
            return await firstPolicy.runLoad(async function runSecondPolicyLoad() {
                return await secondPolicy.runLoad(run);
            });
        },
        takeAttemptErrors(testCase, attempt) {
            return [
                ...firstPolicy.takeAttemptErrors(testCase, attempt),
                ...secondPolicy.takeAttemptErrors(testCase, attempt)
            ];
        },
        takePendingRunErrors() {
            return [
                ...firstPolicy.takePendingRunErrors(),
                ...secondPolicy.takePendingRunErrors()
            ];
        },
        takeRunErrors() {
            return [
                ...firstPolicy.takeRunErrors(),
                ...secondPolicy.takeRunErrors()
            ];
        }
    };
}

export function createRunResourceRuntimePolicy(
    testCases: readonly TestPlanCase[],
    runtimePolicy: TestRuntimePolicy | null,
    timing: ManagedResourceLifecycleTiming
): TestRuntimePolicy {
    const resourcePolicy = createResourceLifecycleRuntimePolicy(testCases, timing);

    return composeRunRuntimePolicies(runtimePolicy, resourcePolicy) ?? resourcePolicy;
}

export function freezeValue<Value>(value: Value): Value {
    if (value !== null && typeof value === 'object') {
        for (const propertyValue of Object.values(value)) {
            freezeValue(propertyValue);
        }

        Object.freeze(value);
    }

    return value;
}

export function resolveRunReporters(
    profile: ProfileConfig,
    fallbackReporters: NormalizedConfig['reporters']
): NonNullable<NormalizedConfig['reporters']> {
    return profile.reporters ?? fallbackReporters ?? [];
}

export function copyRunEngineSelection(engine: RunEngineSelection): RunEngineSelection {
    if (engine.kind === 'instance') {
        return {
            engine: engine.engine,
            kind: 'instance'
        };
    }

    if (engine.kind === 'module') {
        return {
            exportKind: engine.exportKind,
            exportName: engine.exportName,
            kind: 'module',
            moduleUrl: engine.moduleUrl
        };
    }

    return { kind: 'default' };
}

export function runEngineFacts(engine: RunEngineSelection): RunEngineFacts {
    if (engine.kind === 'instance') {
        return { kind: 'instance' };
    }

    if (engine.kind === 'module') {
        return {
            exportKind: engine.exportKind,
            exportName: engine.exportName,
            kind: 'module',
            moduleUrl: engine.moduleUrl
        };
    }

    return { kind: 'default' };
}

export async function observeRunRuntimePolicy<Value>(
    request: RunRequest,
    dependencies: RunOrchestratorDependencies,
    execute: (policy: RunRuntimePolicy) => Promise<Value>
): Promise<Value> {
    return await withRuntimePolicy(function createConfiguredPolicy() {
        return request.capabilityRestrictions.mode === 'enabled'
            ? createRuntimeCapabilityPolicy({
                dependencies: dependencies.runtimeCapabilityPolicy,
                observedStderr: false,
                observedStdout: false
            })
            : createPermissionDenialRuntimePolicy();
    }, execute);
}

export const runWithWorkerAttachments: typeof executeWorkerAttachments = executeWorkerAttachments;

export async function withRunErrorMetadata(
    result: RunResult,
    command: RunCommand,
    host: ResolvedRun['facts']['benchmarkHost']
): Promise<RunResult> {
    const profile = command.config.profiles[command.request.profile];
    if (profile?.testFamily !== 'benchmark') {
        return result;
    }
    return withBenchmarkErrorMetadata(result, command, host);
}
