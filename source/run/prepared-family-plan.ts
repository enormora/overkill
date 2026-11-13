import type { FamilyRunFacts, PreparedFamilyRun } from '../engine/family-run.ts';
import { workIdentityKey } from '../engine/identity.ts';
import type { RunnerFamilyPreparation } from './family-profile-types.ts';
import type { CollectedFamilyMetadata } from './family-catalog.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { familyValueSchema } from './family-transport-schema.ts';

type TestPlan = RunnerFamilyPreparation['sourcePlan'];

export function preparedFamilyMetadata(
    preparation: RunnerFamilyPreparation,
    facts: FamilyRunFacts
): CollectedFamilyMetadata | null {
    if (preparation.definition === null) {
        return null;
    }
    const { prepared, definition } = preparation;
    const catalog = familyValueSchema.parse({ ...collectedRunPlanFromTestPlan(prepared.testPlan), family: null });
    return {
        definition: { ...definition, checkpoint: { preparation: prepared.facts, catalog } },
        facts
    };
}

export function selectedPreparedPlan(prepared: PreparedFamilyRun, selection: TestPlan): TestPlan {
    const available = new Map(prepared.testPlan.cases.map(function identity(testCase) {
        return [ workIdentityKey(testCase.workId), testCase ] as const;
    }));
    function select(testCase: TestPlan['cases'][number]): TestPlan['cases'][number] {
        const current = available.get(workIdentityKey(testCase.workId));
        if (current === undefined) {
            throw new TypeError('Prepared family work changed between invocations.');
        }
        return current;
    }
    return { ...prepared.testPlan, cases: [ select(selection.cases[0]), ...selection.cases.slice(1).map(select) ] };
}
