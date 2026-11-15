import { isDeepStrictEqual } from 'node:util';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { resolvePropertyPolicy } from '../config/property-policy.ts';
import type { PropertyPolicy, PropertyBodyDefinition } from '../engine/property-node.ts';
import { workIdentityKey } from '../engine/identity.ts';
import type { TestPlan, TestPlanCase } from '../engine/test-plan.ts';
import { RunCollectionError } from './run-errors.ts';
import type { CollectedRunPlan, RunTestFamily } from './run-types.ts';

type PropertyCollectionPolicy = {
    readonly testFamily: RunTestFamily;
    readonly propertyPolicy: PropertyPolicy;
    readonly timeoutMilliseconds: number;
};

function validatePropertyControls(testCase: Pick<TestPlanCase, 'controls'>, softMilliseconds: number): void {
    const { capture, timeoutMilliseconds } = testCase.controls;
    if (capture !== null) {
        throw new RunCollectionError('Run profile "property" cannot run test cases with authored capture controls.', {
            cause: null
        }, 'loader');
    }
    if (
        timeoutMilliseconds !== null &&
        (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds <= 0 ||
            timeoutMilliseconds > softMilliseconds)
    ) {
        throw new RunCollectionError(
            [
                `Run profile "property" cannot run test case timeoutMilliseconds ${timeoutMilliseconds};`,
                `expected positive safe integer <= ${softMilliseconds}.`
            ]
                .join(' '),
            { cause: null },
            'loader'
        );
    }
}

function requiresPropertyDeclaration(testCase: TestPlanCase): boolean {
    return testCase.testFamily === 'property' && testCase.execution.kind !== 'skip';
}

function resolvePropertyExecution(testCase: TestPlanCase, defaults: PropertyPolicy): TestPlanCase {
    const { execution } = testCase;
    if (execution.kind !== 'body' || execution.bodyMode !== 'property') {
        if (requiresPropertyDeclaration(testCase)) {
            throw new RunCollectionError('Property test case requires a collected property declaration.', {
                cause: null
            }, 'loader');
        }
        return testCase;
    }
    try {
        const policy = resolvePropertyPolicy(defaults, execution.definition);
        return { ...testCase, execution: { ...execution, policy: { kind: 'resolved', policy } } };
    } catch (error: unknown) {
        throw new RunCollectionError(
            `Invalid property policy for "${testCase.id.title}": ${
                error instanceof Error ? error.message : String(error)
            }`,
            { cause: error },
            'loader'
        );
    }
}

function resolvePropertyCase(testCase: TestPlanCase, settings: PropertyCollectionPolicy): TestPlanCase {
    const { execution } = testCase;
    const propertyBody = execution.kind === 'body' && execution.bodyMode === 'property';
    if (settings.testFamily === 'integration' && !propertyBody) {
        return testCase;
    }
    validatePropertyControls(testCase, settings.timeoutMilliseconds);
    return resolvePropertyExecution(testCase, settings.propertyPolicy);
}

function assertCollectedPropertyPolicy(
    testCase: CollectedRunPlan['discoveredFiles'][number]['cases'][number],
    settings: PropertyCollectionPolicy
): void {
    validatePropertyControls(testCase, settings.timeoutMilliseconds);
    if (testCase.property !== null) {
        const expected = resolvePropertyPolicy(settings.propertyPolicy, testCase.property.definition);
        if (!isDeepStrictEqual(expected, testCase.property.policy)) {
            throw new RunCollectionError(
                'Collected property policy does not match profile and declaration settings.',
                { cause: null },
                'loader'
            );
        }
    }
}

export function assertCollectedPropertyPolicies(plan: CollectedRunPlan, settings: PropertyCollectionPolicy): void {
    for (const file of plan.discoveredFiles) {
        for (const testCase of file.cases) {
            if (settings.testFamily !== 'integration' || testCase.property !== null) {
                assertCollectedPropertyPolicy(testCase, settings);
            }
        }
    }
}

export function resolveTestPlanPropertyPolicy(
    testPlan: TestPlan,
    settings: PropertyCollectionPolicy
): TestPlan {
    function resolveCases(cases: NonEmptyReadonlyArray<TestPlanCase>): NonEmptyReadonlyArray<TestPlanCase> {
        return [
            resolvePropertyCase(cases[0], settings),
            ...cases.slice(1).map(function resolveCase(testCase) {
                return resolvePropertyCase(testCase, settings);
            })
        ];
    }
    return {
        ...testPlan,
        discoveredCases: resolveCases(testPlan.discoveredCases),
        cases: resolveCases(testPlan.cases)
    };
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
