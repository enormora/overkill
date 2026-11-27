import {
    admitAssertion,
    admitBuiltInAssertion,
    invalidAssertionProtocol,
    InvalidAssertionProtocolError,
    matchesDataField,
    matchesRecordedLeaf,
    protocolItems,
    protocolObject,
    type ProtocolRecord
} from '../assertion-protocol/assertion-validation.ts';
import { transferAssertionObservation } from '../assertion-protocol/evaluation.ts';
import type { AssertAssertionNode, AssertionNode } from '../assertion-protocol/assertion-node.ts';
import { assertionProtocolFailure } from './assertion-protocol-failure.ts';
import type { AssertionOrigin, AssertionRecordingContext } from './assertion-lifetime.ts';
import type { TestContractFailure } from './run-result.ts';

type BuilderOwnership = {
    readonly assertion: AssertAssertionNode;
    readonly owner: symbol;
};

const diagnosticOwners = new WeakMap<ProtocolRecord, AssertionRecordingContext>();

export function ownAssertionDiagnostic(diagnostic: ProtocolRecord, owner: AssertionRecordingContext): void {
    diagnosticOwners.set(diagnostic, owner);
}

export function foreignDiagnostic(
    diagnostic: unknown,
    owner: AssertionRecordingContext | null
): boolean {
    const recorded = protocolObject(diagnostic)
        ? diagnosticOwners.get(diagnostic)
        : undefined;
    return recorded !== undefined && recorded !== owner;
}

export function foreignAssertionDiagnostic(origin: AssertionOrigin): TestContractFailure {
    return {
        actual: { reason: 'foreign-diagnostic', operation: 'admit an assertion diagnostic', origin },
        code: 'invalid-assertion-context',
        expected: 'diagnostics owned by this custom assertion invocation',
        kind: 'test-contract',
        summary: 'Injected assertion diagnostics belong to a different assertion context.'
    };
}

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

function foreignReturnedDiagnostic(assertion: ReturnedAssertion, originals: OriginalNodes): boolean {
    const { original, node } = assertion;
    return foreignDiagnostic(original, null) ||
        node.check === 'composite' && !builderOwners.has(original) &&
        node.children.some(function containsForeignDiagnostic(child) {
            return foreignDiagnostic(originals.get(child), null);
        });
}

export type AssertionReturnOwner = {
    readonly identity: symbol;
    readonly origin: AssertionOrigin;
};

export function returnedAssertionOwnershipFailure(
    assertions: readonly ReturnedAssertion[],
    owner: AssertionReturnOwner,
    originals: OriginalNodes
): TestContractFailure | null {
    const seen = new WeakSet<ProtocolRecord>();
    for (const assertion of assertions) {
        if (foreignReturnedDiagnostic(assertion, originals)) {
            return foreignAssertionDiagnostic(owner.origin);
        }
        const failure = previousOwnerFailure(assertion.original, owner.identity, seen) ??
            recordedBuilderChildFailure(assertion.node, originals);
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

function uniquelyReturns(value: unknown, original: AssertAssertionNode): boolean {
    if (value === original) {
        return true;
    }
    return protocolObject(value) && Array.isArray(value) && value.length === 1 && matchesDataField(value, 0, original);
}

export function admitSingleRecordedReturn(
    value: unknown,
    original: AssertAssertionNode | null,
    recorded: AssertionNode | null
): readonly AssertionNode[] | null {
    if (recorded?.source !== 'assert' || original === null || !uniquelyReturns(value, original)) {
        return null;
    }
    return matchesRecordedLeaf(original, recorded) ? [ recorded ] : null;
}

function parseReturnedAssertions(value: unknown): AdmittedReturn {
    const originals: OriginalNodes = new WeakMap();
    const values = protocolObject(value) && Array.isArray(value) ? protocolItems(value, 'return') : [ value ];
    const assertions = values.map(function parseAssertion(original, index): ReturnedAssertion {
        const path = `return[${index}]`;
        if (!protocolObject(original)) {
            throw invalidAssertionProtocol(path, 'expected a protocol record');
        }
        const captured = capturedBuilderAssertion(original);
        const node = captured !== undefined && matchesRecordedLeaf(original, captured)
            ? captured
            : admitAssertion(original, 'assert', path, originals);
        return { original, node };
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
export function requireRecordedAssertion<Node extends AssertionNode>(
    original: Node,
    failContract: (failure: TestContractFailure) => never
): Node;
export function requireRecordedAssertion(
    original: AssertionNode,
    failContract: (failure: TestContractFailure) => never
): AssertionNode {
    const admitted = original.check === 'composite'
        ? admitRecordedAssertion(original, original.source)
        : admission(function parseBuiltIn() {
            return admitBuiltInAssertion(original);
        });
    return admitted.kind === 'accepted' ? admitted.value : failContract(admitted.failure);
}
