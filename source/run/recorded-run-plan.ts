import { currentReplay } from './replay-context.ts';
import { collectedRunPlanFromTestPlanCases } from './collected-run-plan.ts';
import type { ResolvedRun, CollectedRunPlan } from './run-types.ts';

export function recordedRunPlan(run: ResolvedRun): CollectedRunPlan {
    const replay = currentReplay();
    if (replay?.kind === 'record') {
        return replay.record.replayPlan;
    }
    return run.plan.kind === 'local'
        ? collectedRunPlanFromTestPlanCases(run.plan.testPlan, run.plan.testPlan.cases)
        : run.plan.collectedPlan;
}
