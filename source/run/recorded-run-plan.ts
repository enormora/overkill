import { isFamilyPlan } from './family-profile-run.ts';
import { preparedFamilyMetadata } from './prepared-family-plan.ts';
import { currentReplay } from './replay-context.ts';
import { collectedRunPlanFromTestPlanCases } from './collected-run-plan.ts';
import type { ResolvedRun, CollectedRunPlan } from './run-types.ts';

export function recordedRunPlan(run: ResolvedRun): CollectedRunPlan {
    const replay = currentReplay();
    if (replay?.kind === 'record') {
        return replay.record.replayPlan;
    }
    if (run.plan.kind !== 'local') {
        return run.plan.collectedPlan;
    }
    const plan = collectedRunPlanFromTestPlanCases(run.plan.testPlan, run.plan.testPlan.cases);
    return isFamilyPlan(run.plan)
        ? { ...plan, family: preparedFamilyMetadata(run.plan.family.preparation, run.facts.family) }
        : plan;
}
