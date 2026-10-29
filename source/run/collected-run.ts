import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { planCollectedInvocation, type CollectedRunContext } from './collected-run-planning.ts';
import { withFileModuleBoundary } from './file-module-boundary.ts';
import { invalidRequest } from './run-errors.ts';
import { freezeValue } from './run-support.ts';
import { createRunTimingMeasurement } from './run-timing-collection.ts';
import type { CollectedRun, CollectedRunInvocation } from './run-types.ts';
import { executeCollectedInvocation } from './collected-run-invocation.ts';

type RunResult = Awaited<ReturnType<CollectedRun['run']>>;

export function createCollectedRun(context: CollectedRunContext): CollectedRun {
    const activeInvocations = new Set<CollectedRunInvocation>();
    async function run(invocation: CollectedRunInvocation): Promise<RunResult> {
        if (activeInvocations.size > 0) {
            invalidRequest('A collected plan invocation is already running.');
        }
        activeInvocations.add(invocation);
        try {
            return await withFileModuleBoundary(context.moduleBoundary, async function executeBoundedPlan() {
                const timing = createRunTimingMeasurement(context.dependencies.wallClock);
                return await executeCollectedInvocation(context, planCollectedInvocation(context, invocation), timing);
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
        async runWithReporterDelivery(invocation) {
            const delivery = await context.dependencies.reporterDispatcher.trackRunnerErrorDelivery(
                async function trackCollectedRun() {
                    return await run(invocation);
                }
            );
            return {
                deliveredRunnerErrors: delivery.deliveredRunnerErrors,
                result: delivery.result,
                undeliveredRunnerErrors: delivery.undeliveredRunnerErrors
            };
        }
    });
}
