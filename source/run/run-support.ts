import type { NormalizedConfig, MaxConcurrency, TestProfileConfig, Scheduling } from '../config/types.ts';
import { runWithWorkerAttachments as executeWorkerAttachments } from './attachment-worker-context.ts';
import type { TestRuntimePolicy, RunResult, TestPlanCase } from './run-engine-primitives.ts';
import { currentAttachmentCoordinator } from './attachment-coordinator-context.ts';
import {
    createResourceLifecycleRuntimePolicy,
    type ManagedResourceLifecycleTiming
} from './resource-lifecycle.ts';
import {
    createPermissionDenialRuntimePolicy,
    createRuntimeCapabilityPolicy
} from './capability-policy.ts';
import type { RunCommand, RunEngineFacts, RunRequest, ResolvedRun } from './run-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

import {
    readDurationHistoryIndex,
    resultWithUpdatedDurationHistoryAndTiming,
    type DurationHistoryTimingMeasurement,
    type DurationHistoryIndex
} from './duration-history.ts';

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
): Promise<DurationHistoryIndex | null> {
    return await readDurationHistoryIndex(dependencies.runtimeStateStore, projectRoot, runtimeStateDir);
}

export async function finalizeResultWithDurationHistory(
    dependencies: RunOrchestratorDependencies,
    resolvedRun: ResolvedRun,
    result: RunResult,
    timing: DurationHistoryTimingMeasurement | null = null
): Promise<RunResult> {
    const attachmentResult = await (currentAttachmentCoordinator()?.finalize(result) ?? result);
    return await resultWithUpdatedDurationHistoryAndTiming({
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
    profile: TestProfileConfig,
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

export function createRunRuntimePolicy(
    request: RunRequest,
    dependencies: RunOrchestratorDependencies
): RunRuntimePolicy | null {
    return request.capabilityRestrictions.mode === 'enabled'
        ? createRuntimeCapabilityPolicy({
            dependencies: dependencies.runtimeCapabilityPolicy,
            observedStderr: false,
            observedStdout: false
        })
        : createPermissionDenialRuntimePolicy();
}

export const runWithWorkerAttachments: typeof executeWorkerAttachments = executeWorkerAttachments;
