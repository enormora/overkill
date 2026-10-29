import { appendRunnerErrors } from '../engine/execution-result.ts';
import type { RunResult } from './run-engine-primitives.ts';
import type { CollectedInvocationPlan, CollectedRunContext } from './collected-run-planning.ts';
import { reportCollectionErrorResult } from './run-collection-error-result.ts';
import { executeInProcessResolvedRun } from './run-in-process-execution.ts';
import { executeWithRuntimeAttachments } from './runtime-attachment-boundary.ts';
import {
    observeRunRuntimePolicy,
    type ResolvedRunResultFinalizer,
    type RunRuntimePolicy
} from './run-support.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';
import type { RunRecordSession } from './run-record.ts';

type CollectedPlanExecution = {
    readonly record: RunRecordSession | null;
    readonly context: CollectedRunContext;
    readonly finalizeResult: ResolvedRunResultFinalizer;
    readonly plan: CollectedInvocationPlan;
    readonly runtimePolicy: RunRuntimePolicy;
    readonly timing: RunTimingMeasurement;
};

async function executeObservedCollectedPlan(execution: CollectedPlanExecution): Promise<RunResult> {
    const { context, finalizeResult, plan, runtimePolicy, timing } = execution;
    const { dependencies } = context;
    await runtimePolicy.runLoad(async function reuseCollectedPlan() {
        return plan.resolved;
    });
    if (plan.kind === 'empty-selection') {
        const result = await finalizeResult(
            plan.resolved,
            appendRunnerErrors(plan.result, runtimePolicy.takeRunErrors())
        );
        return await reportCollectionErrorResult(
            { ...context.command, request: plan.resolved.request },
            dependencies,
            result,
            { timing, benchmarkHost: null }
        );
    }
    return await executeWithRuntimeAttachments(plan.resolved, dependencies, async function executeObservedPlan() {
        return await executeInProcessResolvedRun(plan.resolved, dependencies, {
            finalizeResult,
            runtimePolicy,
            timing
        });
    }, execution.record);
}

export async function executeCollectedPlan(
    context: CollectedRunContext,
    plan: CollectedInvocationPlan,
    timing: RunTimingMeasurement,
    options: Pick<CollectedPlanExecution, 'finalizeResult' | 'record'>
): Promise<RunResult> {
    return await observeRunRuntimePolicy(
        plan.resolved.request,
        context.dependencies,
        async function executeObservedInvocation(runtimePolicy) {
            return await executeObservedCollectedPlan({ context, ...options, plan, runtimePolicy, timing });
        }
    );
}
