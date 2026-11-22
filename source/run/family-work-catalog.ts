import type { TestPlan } from '../engine/test-plan.ts';
import type { FamilyValue } from '../engine/test-family.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import type { CollectedRunPlan } from './run-types.ts';
import { familyValueSchema } from './family-transport-schema.ts';

export function familyWorkCatalog(plan: CollectedRunPlan): FamilyValue {
    const { implementations, ...catalog } = plan;
    function files(entries: CollectedRunPlan['files']): unknown {
        return entries.map(function file(entry) {
            return {
                ...entry,
                cases: entry.cases.map(function declaration(testCase) {
                    const { implementationDeclaration, ...metadata } = testCase;
                    return metadata;
                })
            };
        });
    }
    return familyValueSchema.parse({
        ...catalog,
        family: null,
        files: files(plan.files),
        discoveredFiles: files(plan.discoveredFiles)
    });
}

export function familyCatalogSnapshot(plan: TestPlan): FamilyValue {
    return familyWorkCatalog(collectedRunPlanFromTestPlan(plan));
}
