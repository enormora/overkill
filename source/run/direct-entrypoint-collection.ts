import { compareDeepValues } from '../compare/comparison.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { collectedRunPlanFromTestPlan } from './collected-run-plan.ts';
import { RunCollectionError } from './run-errors.ts';
import type { CollectedRunPlan } from './run-types.ts';

function differencePath(expected: CollectedRunPlan, actual: CollectedRunPlan): string {
    const comparison = compareDeepValues(actual, expected);

    return JSON.stringify(comparison.path);
}

function normalizedCollectedPlan(plan: CollectedRunPlan): CollectedRunPlan {
    return {
        defined: plan.defined,
        discoveredFiles: structuredClone(plan.discoveredFiles),
        files: structuredClone(plan.files),
        orphans: structuredClone(plan.orphans),
        root: structuredClone(plan.root)
    };
}

export function assertDirectEntrypointCollectionMatches(
    expectedTestPlan: TestPlan,
    actual: CollectedRunPlan
): void {
    const expected = normalizedCollectedPlan(collectedRunPlanFromTestPlan(expectedTestPlan));
    const normalizedActual = normalizedCollectedPlan(actual);

    const comparison = compareDeepValues(normalizedActual, expected);

    if (comparison.passed) {
        return;
    }

    const path = differencePath(expected, normalizedActual);

    throw new RunCollectionError(
        `runIfMain() argument does not match the module's exported testNode at ${path}.`,
        { cause: null },
        'loader'
    );
}
