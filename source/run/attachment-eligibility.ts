import { workIdentityKey } from '../engine/identity.ts';
import { collectedRunCaseEntries } from './collected-run-plan.ts';
import type { ResolvedRun } from './run-types.ts';

export function runHasAttachmentScopes(resolved: ResolvedRun): boolean {
    if (resolved.facts.execution.testFamily !== 'integration' || resolved.facts.cases.length === 0) {
        return false;
    }
    const selected = new Set(resolved.facts.cases.map(function selectedWork(entry) {
        return workIdentityKey(entry.workId);
    }));
    const cases = resolved.plan.kind === 'local'
        ? resolved.plan.testPlan.cases.map(function localCase(testCase) {
            return { testCase, workId: testCase.workId };
        })
        : collectedRunCaseEntries(resolved.plan.collectedPlan);
    return cases.some(function hasAttachmentScope(entry) {
        return selected.has(workIdentityKey(entry.workId)) &&
            (entry.testCase.resourceAttachments.resourceGraph.length > 0 ||
                entry.testCase.resourceAttachments.runtimeGraphs.length > 0);
    });
}
