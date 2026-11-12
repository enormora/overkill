import type { PropertyPolicy } from './property-node.ts';
import type { TestPlan } from './test-plan.ts';
import { resolveTestPlanPropertyPolicy } from './property-plan.ts';
import { expandRuntimeMatrices } from './runtime-matrix-expansion.ts';
import { calibrationCapturePlan } from './benchmark-calibration-plan.ts';

export type TestPlanCollectionPolicy = {
    readonly runtimeMatrices: boolean;
    readonly benchmarkCalibration: boolean;
    readonly property: { readonly policy: PropertyPolicy; readonly timeoutMilliseconds: number; } | null;
};

export function applyPlanCollectionPolicy(plan: TestPlan, policy: TestPlanCollectionPolicy | null): TestPlan {
    if (policy === null) {
        return plan;
    }
    const runtimePlan = policy.runtimeMatrices ? expandRuntimeMatrices(plan) : plan;
    const expanded = policy.benchmarkCalibration ? calibrationCapturePlan(runtimePlan, true) : runtimePlan;
    const { property } = policy;
    return property === null
        ? expanded
        : resolveTestPlanPropertyPolicy(expanded, property.policy, property.timeoutMilliseconds);
}
