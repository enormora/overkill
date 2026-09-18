import type { TestPlan } from '../engine/test-plan.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    finalizeResultWithDurationHistory,
    createRunResourceRuntimePolicy,
    type RunRuntimePolicy
} from './run-support.ts';
import type {
    ResolvedRun,
    RunOrchestrator,
    RunResourceUsagePolicy,
    RunScheduling
} from './run-types.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
type RunResourceUsageTracker = ReturnType<RunOrchestratorDependencies['createResourceUsageTracker']>;
type LocalResolvedRun = ResolvedRun & {
    readonly plan: {
        readonly kind: 'local';
        readonly testPlan: TestPlan;
    };
};

function currentRunStartTime(dependencies: RunOrchestratorDependencies): string {
    const startedAt = new Date(dependencies.wallClock.currentTimestampInMilliseconds);

    return startedAt.toISOString();
}

function resolveEngineExecutionMode(scheduling: RunScheduling): 'concurrent-in-process' | 'serial-in-process' {
    return scheduling === 'concurrent' ? 'concurrent-in-process' : 'serial-in-process';
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
    runtimePolicy: RunRuntimePolicy | null
): Promise<RunResult> {
    const { resourceUsagePolicy } = resolvedRun.facts.execution;

    return await dependencies.execute(resolvedRun.plan.testPlan, {
        execution: { mode: resolveEngineExecutionMode(resolvedRun.facts.execution.scheduling) },
        outputRenderer: resolvedRun.config.outputRenderer,
        async finalizeResult(result) {
            return await finalizeResultWithDurationHistory(dependencies, resolvedRun, result);
        },
        reporters: resolvedRun.reporters,
        resourceBudgets: resourceUsagePolicy.budgets,
        resourceUsageTracker: createExecutionResourceUsageTracker(resourceUsagePolicy, dependencies),
        runtimePolicy: createRunResourceRuntimePolicy(resolvedRun.plan.testPlan.cases, runtimePolicy),
        runFacts: resolvedRun.facts,
        startedAt: currentRunStartTime(dependencies),
        timeoutPolicy: {
            hardTimeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.hardMilliseconds,
            timeoutMilliseconds: resolvedRun.facts.execution.timeoutPolicy.softMilliseconds
        }
    });
}
