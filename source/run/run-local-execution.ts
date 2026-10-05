import type { TestPlan } from '../engine/test-plan.ts';
import { reporterWithAttachments } from './attachment-reporter.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import {
    createRunResourceRuntimePolicy,
    engineExecution,
    type ResolvedRunResultFinalizer,
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

export type LocalExecutionOptions = {
    readonly finalizeResult: ResolvedRunResultFinalizer;
    readonly runtimePolicy: RunRuntimePolicy | null;
    readonly timing: RunTimingMeasurement | null;
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
    options: LocalExecutionOptions
): Promise<RunResult> {
    const { resourceUsagePolicy } = resolvedRun.facts.execution;
    const resourceTiming = options.timing === null
        ? null
        : createResourceLifecycleTiming({
            clock: dependencies.wallClock,
            processId: String(process.pid),
            target: { kind: 'parent', record: options.timing.record },
            workerId: null
        });

    return await dependencies.execute(resolvedRun.plan.testPlan, {
        execution: engineExecution(
            resolvedRun.facts.execution.scheduling,
            resolvedRun.facts.execution.maxConcurrency
        ),
        outputRenderer: resolvedRun.config.outputRenderer,
        async finalizeResult(result) {
            return await options.finalizeResult(resolvedRun, result);
        },
        reporters: resolvedRun.reporters.map(reporterWithAttachments),
        retryPolicy: resolvedRun.facts.execution.retries,
        resourceBudgets: resourceUsagePolicy.budgets,
        resourceUsageTracker: createExecutionResourceUsageTracker(resourceUsagePolicy, dependencies),
        runtimePolicy: createRunResourceRuntimePolicy(
            resolvedRun.plan.testPlan.cases,
            options.runtimePolicy,
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
