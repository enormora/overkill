import { isDeepStrictEqual } from 'node:util';
import {
    resolveTestPlanPropertyPolicy as resolveEnginePropertyPolicy,
    validatePropertyControls
} from '../engine/property-plan.ts';
import { resolvePropertyPolicy } from '../engine/property-policy.ts';
import type { PropertyPolicy, PropertyBodyDefinition } from '../engine/property-node.ts';
import { workIdentityKey } from '../engine/identity.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';
import { RunCollectionError } from './run-errors.ts';
import type { CollectedRunPlan } from './run-types.ts';

export function assertCollectedPropertyPolicies(
    plan: CollectedRunPlan,
    defaults: PropertyPolicy,
    softMilliseconds: number
): void {
    for (const file of plan.discoveredFiles) {
        for (const testCase of file.cases) {
            validatePropertyControls(testCase, softMilliseconds);
            if (testCase.property !== null) {
                const expected = resolvePropertyPolicy(defaults, testCase.property.definition);
                if (!isDeepStrictEqual(expected, testCase.property.policy)) {
                    throw new RunCollectionError(
                        'Collected property policy does not match profile and declaration settings.',
                        { cause: null },
                        'loader'
                    );
                }
            }
        }
    }
}

export function resolveTestPlanPropertyPolicy(
    testPlan: TestPlan,
    defaults: PropertyPolicy,
    softMilliseconds: number
): TestPlan {
    try {
        return resolveEnginePropertyPolicy(testPlan, defaults, softMilliseconds);
    } catch (error: unknown) {
        throw new RunCollectionError(
            String(error instanceof Error ? error.message : error),
            { cause: error },
            'loader'
        );
    }
}

export function testCasePropertyPolicy(testCase: TestPlanCase): PropertyPolicy | null {
    const { execution } = testCase;
    if (execution.kind !== 'body' || execution.bodyMode !== 'property') {
        return null;
    }
    if (execution.policy.kind !== 'resolved') {
        throw new RunCollectionError(
            'Property execution requires resolved collection policy.',
            { cause: null },
            'loader'
        );
    }
    return execution.policy.policy;
}

export function testCasePropertySummary(
    testCase: TestPlanCase
): { readonly definition: PropertyBodyDefinition; readonly policy: PropertyPolicy; } | null {
    const { execution } = testCase;
    if (execution.kind !== 'body' || execution.bodyMode !== 'property') {
        return null;
    }
    if (execution.policy.kind !== 'resolved') {
        throw new RunCollectionError('Property collection requires resolved policy.', { cause: null }, 'loader');
    }
    return {
        definition: {
            kind: execution.definition.kind,
            settingsDeclarations: execution.definition.settingsDeclarations
        },
        policy: execution.policy.policy
    };
}

export type AssignedPropertyPolicy = {
    readonly work: TestPlanCase['workId'];
    readonly policy: PropertyPolicy;
};

export function assertAssignedPropertyPolicies(testPlan: TestPlan, policies: readonly AssignedPropertyPolicy[]): void {
    const actual = testPlan.cases.flatMap(function propertyAssignment(testCase) {
        const policy = testCasePropertyPolicy(testCase);
        return policy === null ? [] : [ { work: testCase.workId, policy } ];
    });
    const expected = new Map(policies.map(function keyedPolicy(entry) {
        return [ workIdentityKey(entry.work), entry.policy ];
    }));
    if (
        expected.size !== policies.length || actual.length !== policies.length ||
        actual.some(function policyChanged(entry) {
            return !isDeepStrictEqual(entry.policy, expected.get(workIdentityKey(entry.work)));
        })
    ) {
        throw new RunCollectionError(
            'Property policy changed between collection and execution.',
            { cause: null },
            'loader'
        );
    }
}
