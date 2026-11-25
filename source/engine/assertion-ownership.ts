import {
    admitAssertion,
    invalidAssertionProtocol,
    InvalidAssertionProtocolError,
    protocolItems,
    protocolObject,
    type ProtocolRecord
} from '../assertion-protocol/assertion-validation.ts';
import { transferAssertionObservation } from '../assertion-protocol/evaluation.ts';
import type { AssertAssertionNode, AssertionNode } from '../assertion-protocol/assertion-node.ts';
import { assertionProtocolFailure } from './assertion-protocol-failure.ts';
import type { TestContractFailure } from './run-result.ts';

type BuilderOwnership = {
    readonly assertion: AssertAssertionNode;
    readonly owner: symbol;
};

const builderOwners = new WeakMap<ProtocolRecord, BuilderOwnership>();

export function recordBuilderOwner(original: AssertAssertionNode, owner: symbol, assertion: AssertAssertionNode): void {
    builderOwners.set(original, { assertion, owner });
}

export function capturedBuilderAssertion(original: ProtocolRecord): AssertAssertionNode | undefined {
    return builderOwners.get(original)?.assertion;
}

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

function recordedBuilderChildFailure(
    assertion: AssertionNode,
    originals: WeakMap<ProtocolRecord, ProtocolRecord>
): TestContractFailure | null {
    if (
        assertion.check === 'composite' && assertion.children.some(function isRecordedChild(child) {
            const original = originals.get(child);
            return original !== undefined && builderOwners.has(original);
        })
    ) {
        return ownershipFailure('child-reuse');
    }
    return null;
}

export type ReturnedAssertion = {
    readonly original: ProtocolRecord;
    readonly node: AssertAssertionNode;
};

export type AssertionIdentity = ProtocolRecord;
export type OriginalNodes = WeakMap<AssertionIdentity, AssertionIdentity>;

function previousOwnerFailure(
    original: ProtocolRecord,
    owner: symbol,
    seen: WeakSet<ProtocolRecord>
): TestContractFailure | null {
    const recordedOwner = builderOwners.get(original)?.owner;
    if (recordedOwner === undefined) {
        return null;
    }
    if (recordedOwner !== owner) {
        return ownershipFailure('foreign-owner');
    }
    if (seen.has(original)) {
        return ownershipFailure('duplicate-node');
    }
    seen.add(original);
    return null;
}

export function returnedAssertionOwnershipFailure(
    assertions: readonly ReturnedAssertion[],
    owner: symbol,
    originals: OriginalNodes
): TestContractFailure | null {
    const seen = new WeakSet<ProtocolRecord>();
    for (const { original, node } of assertions) {
        const failure = previousOwnerFailure(original, owner, seen) ?? recordedBuilderChildFailure(node, originals);
        if (failure !== null) {
            return failure;
        }
    }
    return null;
}

type Accepted<Value> = { readonly kind: 'accepted'; readonly value: Value; };
type Rejected = { readonly kind: 'rejected'; readonly failure: TestContractFailure; };
type Admission<Value> = Accepted<Value> | Rejected;

function admission<Value>(parse: () => Value): Admission<Value> {
    try {
        return { kind: 'accepted', value: parse() };
    } catch (error) {
        if (!(error instanceof InvalidAssertionProtocolError)) {
            throw error;
        }
        return { kind: 'rejected', failure: assertionProtocolFailure(error) };
    }
}

type AdmittedReturn = {
    readonly assertions: readonly ReturnedAssertion[];
    readonly originals: OriginalNodes;
};

function parseReturnedAssertions(value: unknown): AdmittedReturn {
    const originals: OriginalNodes = new WeakMap();
    const values = protocolObject(value) && Array.isArray(value) ? protocolItems(value, 'return') : [ value ];
    const assertions = values.map(function parseAssertion(original, index): ReturnedAssertion {
        const path = `return[${index}]`;
        if (!protocolObject(original)) {
            throw invalidAssertionProtocol(path, 'expected a protocol record');
        }
        return { original, node: admitAssertion(original, 'assert', path, originals) };
    });
    return { assertions, originals };
}

export function admitReturnedAssertions(value: unknown): Admission<AdmittedReturn> {
    return admission(function parse() {
        return parseReturnedAssertions(value);
    });
}

function preserveChildObservations(node: AssertionNode, originals: OriginalNodes): void {
    if (node.check !== 'composite') {
        return;
    }
    for (const child of node.children) {
        const original = originals.get(child);
        if (original !== undefined) {
            transferAssertionObservation(original, child);
        }
    }
}

export function admitRecordedAssertion<Source extends AssertionNode['source']>(
    original: AssertionNode,
    source: Source
): Admission<Extract<AssertionNode, { readonly source: Source; }>> {
    const originals: OriginalNodes = new WeakMap();
    const admitted = admission(function parse() {
        return admitAssertion(original, source, 'assertion', originals);
    });
    if (admitted.kind === 'rejected') {
        return admitted;
    }
    const failure = recordedBuilderChildFailure(admitted.value, originals);
    if (failure !== null) {
        return { kind: 'rejected', failure };
    }
    transferAssertionObservation(original, admitted.value);
    preserveChildObservations(admitted.value, originals);
    return admitted;
}
export function requireRecordedAssertion<Source extends AssertionNode['source']>(
    original: AssertionNode,
    source: Source,
    failContract: (failure: TestContractFailure) => never
): Extract<AssertionNode, { readonly source: Source; }> {
    const admitted = admitRecordedAssertion(original, source);
    return admitted.kind === 'accepted' ? admitted.value : failContract(admitted.failure);
}
