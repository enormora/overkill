import { disposeResolvedFamily, observeResolvedFamily } from './family-profile-run.ts';
import { runnerResult } from './runner-result.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { planCollectedInvocation, type CollectedRunContext } from './collected-run-planning.ts';
import { withFileModuleBoundary } from './file-module-boundary.ts';
import { invalidRequest } from './run-errors.ts';
import { freezeValue } from './run-support.ts';
import { createRunTimingMeasurement } from './run-timing-collection.ts';
import type { CollectedRun, CollectedRunInvocation } from './run-types.ts';
import { executeCollectedInvocation } from './collected-run-invocation.ts';

type RunResult = Awaited<ReturnType<CollectedRun['run']>>;

export async function createCollectedRun(context: CollectedRunContext): Promise<CollectedRun> {
    await disposeResolvedFamily(context.resolved);
    const activeInvocations = new Set<CollectedRunInvocation>();
    async function run(invocation: CollectedRunInvocation): Promise<RunResult> {
        if (activeInvocations.size > 0) {
            invalidRequest('A collected plan invocation is already running.');
        }
        activeInvocations.add(invocation);
        try {
            return await withFileModuleBoundary(context.moduleBoundary, async function executeBoundedPlan() {
                const timing = createRunTimingMeasurement(context.dependencies.wallClock);
                const plan = await planCollectedInvocation(context, invocation);
                return runnerResult(
                    await observeResolvedFamily(plan.resolved, async function executeInvocation() {
                        return await executeCollectedInvocation(context, plan, timing);
                    })
                );
            });
        } finally {
            activeInvocations.delete(invocation);
        }
    }
    return Object.freeze({
        facts: context.resolved.facts,
        plan: freezeValue(
            context.resolved.plan.kind === 'local'
                ? collectedRunPlanFromTestPlan(context.resolved.plan.testPlan)
                : context.resolved.plan.collectedPlan
        ),
        run,
        async runWithReporterDelivery(invocation: CollectedRunInvocation) {
            const delivery = await context.dependencies.reporterDispatcher.trackRunnerErrorDelivery(
                async function trackCollectedRun() {
                    return await run(invocation);
                }
            );
            return {
                deliveredRunnerErrors: delivery.deliveredRunnerErrors,
                result: runnerResult(delivery.result),
                undeliveredRunnerErrors: delivery.undeliveredRunnerErrors
            };
        }
    });
}
