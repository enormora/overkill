import type { AssertAssertionNode } from '../assertion-protocol/assertion-node.ts';
import type { TestContractFailure } from './run-result.ts';

const builderOwners = new WeakMap<object, symbol>();

const summaryByReason = {
    'child-reuse': 'Recorded builder assertions must be returned as top-level assertions.',
    'duplicate-node': 'A recorded builder assertion cannot be returned more than once.',
    'foreign-owner': 'A recorded builder assertion belongs to a different assertion context.'
} as const;

function ownershipFailure(actual: keyof typeof summaryByReason): TestContractFailure {
    return {
        actual,
        code: 'invalid-returned-builder-assertion',
        expected: 'recorded builder assertions from this context, each returned once at the top level',
        kind: 'test-contract',
        summary: summaryByReason[actual]
    };
}

export function recordedBuilderChildFailure(
    assertion: AssertAssertionNode | null | undefined
): TestContractFailure | null {
    if (assertion?.check === 'composite' && Array.isArray(assertion.children) &&
        assertion.children.some(function isRecordedBuilder(child) {
            return builderOwners.has(child);
        })) {
        return ownershipFailure('child-reuse');
    }
    return null;
}

export function registerBuilderAssertion(assertion: AssertAssertionNode, owner: symbol): void {
    builderOwners.set(assertion, owner);
}

export function returnedBuilderOwnershipFailure(
    assertions: readonly AssertAssertionNode[],
    owner: symbol
): TestContractFailure | null {
    const seen = new Set<AssertAssertionNode>();
    for (const assertion of assertions) {
        const recordedOwner = builderOwners.get(assertion);
        if (recordedOwner !== undefined) {
            if (recordedOwner !== owner) {
                return ownershipFailure('foreign-owner');
            }
            if (seen.has(assertion)) {
                return ownershipFailure('duplicate-node');
            }
            seen.add(assertion);
        }
        const childFailure = recordedBuilderChildFailure(assertion);
        if (childFailure !== null) {
            return childFailure;
        }
    }
    return null;
}
