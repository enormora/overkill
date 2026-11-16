import { implementationPlan, withImplementationPlan } from '../engine/body-reference-plan.ts';
import type { ImplementationCatalog } from '../implementation-catalog.ts';
import type { FamilyRunFacts, PreparedFamilyRun } from '../engine/family-run.ts';
import { workIdentityKey } from '../engine/identity.ts';
import type { LocalFamilyRunPlan, RunnerFamilyPreparation } from './family-profile-types.ts';
import { familyWorkCatalog } from './family-work-catalog.ts';
import type { CollectedFamilyMetadata } from './family-catalog.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';

type TestPlan = RunnerFamilyPreparation['sourcePlan'];

export function preparedFamilyMetadata(
    preparation: RunnerFamilyPreparation,
    facts: FamilyRunFacts
): CollectedFamilyMetadata | null {
    if (preparation.definition === null) {
        return null;
    }
    const { prepared, definition } = preparation;
    const catalog = familyWorkCatalog(collectedRunPlanFromTestPlan(prepared.testPlan));
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

type CollectedFamilySelection = {
    readonly plan: LocalFamilyRunPlan;
    readonly implementations: ImplementationCatalog | null;
};
export function collectedFamilyPlan(
    plan: Pick<LocalFamilyRunPlan, 'kind' | 'testPlan'>,
    family: LocalFamilyRunPlan['family']
): CollectedFamilySelection {
    const state = implementationPlan(family.collected.testPlan);
    return {
        plan: {
            ...plan,
            testPlan: state === null ? plan.testPlan : withImplementationPlan(plan.testPlan, state),
            family
        },
        implementations: state?.catalog ?? null
    };
}
