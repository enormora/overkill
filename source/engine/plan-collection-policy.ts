import type { PropertyPolicy } from './property-node.ts';
import type { TestPlan } from './test-plan.ts';
import { resolveTestPlanPropertyPolicy } from './property-plan.ts';
import { expandRuntimeMatrices } from './runtime-matrix-expansion.ts';
import { calibrationCapturePlan } from './benchmark-calibration-plan.ts';

type PropertyRunPolicy = { readonly policy: PropertyPolicy; readonly timeoutMilliseconds: number; };
type PropertyFamilyPolicy = PropertyRunPolicy & { readonly testFamily: 'integration' | 'property'; };

export type TestPlanCollectionPolicy = {
    readonly runtimeMatrices: boolean;
    readonly benchmarkCalibration: boolean;
    readonly property: PropertyFamilyPolicy | PropertyRunPolicy | null;
};

function propertyCollectionFamily(policy: PropertyFamilyPolicy | PropertyRunPolicy): 'integration' | 'property' {
    const family: unknown = Object.hasOwn(policy, 'testFamily') ? Reflect.get(policy, 'testFamily') : 'property';
    if (family !== 'integration' && family !== 'property') {
        throw new TypeError('Property collection requires a property or integration family.');
    }
    return family;
}

export function applyPlanCollectionPolicy(plan: TestPlan, policy: TestPlanCollectionPolicy | null): TestPlan {
    if (policy === null) {
        return plan;
    }
    const runtimePlan = policy.runtimeMatrices ? expandRuntimeMatrices(plan) : plan;
    const expanded = policy.benchmarkCalibration ? calibrationCapturePlan(runtimePlan, true) : runtimePlan;
    const { property } = policy;
    return property === null
        ? expanded
        : resolveTestPlanPropertyPolicy(expanded, {
            testFamily: propertyCollectionFamily(property),
            propertyPolicy: property.policy,
            timeoutMilliseconds: property.timeoutMilliseconds
        });
}
