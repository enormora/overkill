import { appendRunnerErrors } from '../engine/execution-result.ts';
import type { RunResult } from './run-engine-primitives.ts';
import type { CollectedInvocationPlan, CollectedRunContext } from './collected-run-planning.ts';
import { reportCollectionErrorResult } from './run-collection-error-result.ts';
import { executeInProcessResolvedRun } from './run-in-process-execution.ts';
import { executeWithRuntimeAttachments } from './runtime-attachment-boundary.ts';
import {
    createRunRuntimePolicy,
    finalizeResultWithDurationHistory,
    type ResolvedRunResultFinalizer,
    type RunRuntimePolicy
} from './run-support.ts';
import type { RunTimingMeasurement } from './run-timing-collection.ts';

type CollectedPlanExecution = {
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
            timing
        );
    }
    return await executeWithRuntimeAttachments(plan.resolved, dependencies, async function executeObservedPlan() {
        return await executeInProcessResolvedRun(plan.resolved, dependencies, {
            finalizeResult,
            runtimePolicy,
            timing
        });
    });
}

async function executeCollectedPlan(
    context: CollectedRunContext,
    plan: CollectedInvocationPlan,
    timing: RunTimingMeasurement,
    finalizeResult: ResolvedRunResultFinalizer
): Promise<RunResult> {
    const runtimePolicy = createRunRuntimePolicy(plan.resolved.request, context.dependencies);
    try {
        return await executeObservedCollectedPlan({ context, finalizeResult, plan, runtimePolicy, timing });
    } finally {
        runtimePolicy.takeRunErrors();
    }
}

export async function executeCollectedInvocation(
    context: CollectedRunContext,
    plan: CollectedInvocationPlan,
    timing: RunTimingMeasurement
): Promise<RunResult> {
    const { dependencies } = context;
    if (plan.resolved.request.coverage) {
        const { runRecordedCoverage } = await import('./recorded-coverage-run.ts');
        return await runRecordedCoverage({
            command: { ...context.command, request: plan.resolved.request },
            dependencies,
            async execute({ record, session }) {
                await record.recordFacts(plan.resolved.facts);
                return await executeCollectedPlan(
                    context,
                    plan,
                    timing,
                    async function finalizeCoveredResult(run, result) {
                        const covered = await session.finalize(result);
                        return await record.checkpointResult(
                            await finalizeResultWithDurationHistory(dependencies, run, covered, timing)
                        );
                    }
                );
            },
            input: { ...context.input, request: plan.resolved.request },
            timing
        });
    }
    return await executeCollectedPlan(context, plan, timing, async function finalizeCollectedResult(run, result) {
        return await finalizeResultWithDurationHistory(dependencies, run, result, timing);
    });
}
