import { resolveSourceLocations } from '../assertion-protocol/source-location.ts';
import type { TestPlan, TestPlanCase } from './test-plan.ts';

function resolvedCase(testCase: TestPlanCase): TestPlanCase {
    return {
        ...testCase,
        definitionLocations: resolveSourceLocations(testCase.definitionLocations),
        suitePath: testCase.suitePath.map(function resolveSuite(entry) {
            return { ...entry, definitionLocations: resolveSourceLocations(entry.definitionLocations) };
        })
    };
}
export function resolvedPlanLocations(plan: TestPlan): TestPlan {
    return {
        ...plan,
        cases: [ resolvedCase(plan.cases[0]), ...plan.cases.slice(1).map(resolvedCase) ],
        discoveredCases: [ resolvedCase(plan.discoveredCases[0]), ...plan.discoveredCases.slice(1).map(resolvedCase) ],
        orphans: plan.orphans.map(function resolveOrphan(orphan) {
            return { ...orphan, definitionLocations: resolveSourceLocations(orphan.definitionLocations) };
        })
    };
}
