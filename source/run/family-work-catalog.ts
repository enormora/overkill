import type { FamilyValue } from '../engine/test-family.ts';
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
