import type { TestPlan } from '../engine/test-plan.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    createRunResourceRuntimePolicy,
    engineExecution,
    finalizeResultWithDurationHistory,
    type RunRuntimePolicy
} from './run-support.ts';
import type {
    ResolvedRun,
    RunOrchestrator,
    RunResourceUsagePolicy
} from './run-types.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';
import { createResourceLifecycleTiming } from './resource-lifecycle-timing.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
type RunResourceUsageTracker = ReturnType<RunOrchestratorDependencies['createResourceUsageTracker']>;
type LocalResolvedRun = ResolvedRun & {
    readonly plan: {
        readonly kind: 'local';
        readonly testPlan: TestPlan;
    };
};

function currentRunStartTime(dependencies: RunOrchestratorDependencies): string {
    const startedAt = new Date(dependencies.wallClock.currentUnixEpochMilliseconds);

    return startedAt.toISOString();
}

function createExecutionResourceUsageTracker(
    policy: RunResourceUsagePolicy,
    dependencies: RunOrchestratorDependencies
): RunResourceUsageTracker | null {
    if (!policy.measure) {
        return null;
    }

    return dependencies.createResourceUsageTracker({
        samplingIntervalMilliseconds: policy.samplingIntervalMilliseconds
    });
}

export async function executeLocalResolvedRun(
    resolvedRun: LocalResolvedRun,
    dependencies: RunOrchestratorDependencies,
    runtimePolicy: RunRuntimePolicy | null,
    timing: RunTimingMeasurement | null = null
): Promise<RunResult> {
    const { resourceUsagePolicy } = resolvedRun.facts.execution;
    const resourceTiming = timing === null
        ? null
        : createResourceLifecycleTiming({
            clock: dependencies.wallClock,
            processId: String(process.pid),
            target: { kind: 'parent', record: timing.record },
            workerId: null
        });

    return await dependencies.execute(resolvedRun.plan.testPlan, {
        execution: engineExecution(
            resolvedRun.facts.execution.scheduling,
            resolvedRun.facts.execution.maxConcurrency
        ),
        outputRenderer: resolvedRun.config.outputRenderer,
        async finalizeResult(result) {
            return await finalizeResultWithDurationHistory(dependencies, resolvedRun, result, timing);
        },
        reporters: resolvedRun.reporters,
        resourceBudgets: resourceUsagePolicy.budgets,
        resourceUsageTracker: createExecutionResourceUsageTracker(resourceUsagePolicy, dependencies),
        runtimePolicy: createRunResourceRuntimePolicy(
            resolvedRun.plan.testPlan.cases,
            runtimePolicy,
            resourceTiming
        ),
        runFacts: resolvedRun.facts,
        startedAt: currentRunStartTime(dependencies),
        timeoutPolicy: {
            hardTimeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds,
            timeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.softMilliseconds
        }
    });
}
