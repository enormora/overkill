import { assertionPasses, captureAssertion } from '../assertion-protocol/evaluation.ts';
import type {
    AssertAssertionNode,
    AssertionNode,
    RequireAssertionNode
} from '../assertion-protocol/assertion-node.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import {
    admitRecordedAssertion,
    admitReturnedAssertions,
    admitSingleRecordedReturn,
    capturedBuilderAssertion,
    recordBuilderOwner,
    requireRecordedAssertion,
    returnedAssertionOwnershipFailure,
    type AssertionIdentity,
    type AssertionReturnOwner,
    type OriginalNodes,
    type ReturnedAssertion
} from './assertion-ownership.ts';
import { RequireFailedSignalError } from './assertion-control-error.ts';
import { recordDebugEntry, recordDebugAssertion } from './test-debug-recording.ts';
import { createPropertyEvidenceRecorder } from './property-evidence.ts';
import type { PropertyInvocationEvidence } from './property-failure-evidence.ts';
import type { TestContractFailure } from './run-result.ts';

import { createAssertionContext, type AssertionContext, type AssertionOrigin } from './assertion-lifetime.ts';

type RecordedAssertion = {
    readonly assertion: AssertionNode | null;
    readonly builderAssertion: AssertAssertionNode | null;
};

type RecordedRequireMergeStep = {
    readonly assertions: readonly AssertionNode[];
    readonly recordIndex: number;
};

const discardedAssertion = Symbol('discarded assertion');

export type PendingRecordedAssert = {
    readonly discard: () => void;
    readonly resolve: (assertion: AssertAssertionNode) => void;
};

type AssertionRecording = {
    readonly recordPropertyEvidence: (evidence: PropertyInvocationEvidence) => boolean;
    readonly propertyEvidence: () => readonly PropertyInvocationEvidence[];
    readonly activeRecordedAssertions: () => readonly AssertionNode[];
    readonly hasContractFailures: () => boolean;
    readonly contractFailures: () => readonly TestContractFailure[];
    readonly retainContractFailures: (failures: readonly TestContractFailure[]) => void;
    readonly collect: () => NonEmptyReadonlyArray<AssertAssertionNode>;
    readonly completedThrowingAssertions: () => TestContractFailure | readonly AssertionNode[];
    readonly failContract: (failure: TestContractFailure) => never;
    readonly plan: (count: number) => void;
    readonly recordAssert: (assertion: AssertAssertionNode) => void;
    readonly recordPendingAssert: () => PendingRecordedAssert;
    readonly recordRequire: (assertion: RequireAssertionNode) => void;
    readonly requireFailed: () => boolean;
    readonly returnedAssertions: (assertionResult: unknown) => TestContractFailure | readonly AssertionNode[];
    readonly validateAssertionCount: (assertionCount: number) => TestContractFailure | null;
};

export type AssertionRecorder = AssertionContext & AssertionRecording;

export function assertNonEmptyItems<Item>(
    items: readonly Item[],
    message: string
): asserts items is NonEmptyReadonlyArray<Item> {
    if (items.length === 0) {
        throw new TypeError(message);
    }
}

function createNoAssertionsFailure(): TestContractFailure {
    return {
        actual: 0,
        code: 'no-assertions',
        expected: 'at least one assertion',
        kind: 'test-contract',
        summary: 'Expected at least one assertion.'
    };
}

function createInvalidPlanFailure(actual: unknown): TestContractFailure {
    return {
        actual,
        code: 'invalid-plan',
        expected: 'positive integer plan before assertions',
        kind: 'test-contract',
        summary: 'Assertion plan must be a positive integer before assertions.'
    };
}

function createPlanMismatchFailure(actual: number, expected: number): TestContractFailure {
    return {
        actual,
        code: 'plan-mismatch',
        expected: String(expected),
        kind: 'test-contract',
        summary: 'Assertion plan count did not match.'
    };
}

function createDeadBuilderAssertionFailure(): TestContractFailure {
    return {
        actual: 'missing recorded builder assertion',
        code: 'dead-builder-assertion',
        expected: 'returned assertions include every recorded builder assertion',
        kind: 'test-contract',
        summary: 'Returned assertions must include every recorded builder assertion.'
    };
}

function createPendingAsyncAssertionFailure(): TestContractFailure {
    return {
        actual: 'pending async assertion',
        code: 'pending-async-assertion',
        expected: 'all async assertions awaited before collect',
        kind: 'test-contract',
        summary: 'Async assertion must be awaited before scope.assert.collect().'
    };
}

export function isTestContractFailure(
    value: TestContractFailure | readonly AssertionNode[]
): value is TestContractFailure {
    return !Array.isArray(value);
}

function builderAssertionsInReturnedOrder(
    builderAssertions: readonly AssertAssertionNode[],
    returnedAssertions: readonly ReturnedAssertion[]
): boolean {
    let returnedIndex = 0;

    return builderAssertions.every(function builderAssertionReturned(builderAssertion) {
        while (returnedIndex < returnedAssertions.length) {
            const returnedAssertion = returnedAssertions[returnedIndex];
            returnedIndex += 1;

            if (returnedAssertion?.original === builderAssertion) {
                return true;
            }
        }

        return false;
    });
}

function recordContainsBuilderAssertion(
    recorded: RecordedAssertion | undefined,
    builderAssertion: AssertionIdentity
): recorded is RecordedAssertion {
    return Object.is(recorded?.builderAssertion, builderAssertion);
}

function requireAssertionFromRecord(recorded: RecordedAssertion | undefined): RequireAssertionNode | null {
    if (recorded?.assertion?.source === 'require') {
        return recorded.assertion;
    }

    return null;
}

function requireAssertionsFromRecord(recorded: RecordedAssertion | undefined): readonly RequireAssertionNode[] {
    const requireAssertion = requireAssertionFromRecord(recorded);

    if (requireAssertion !== null) {
        return [ requireAssertion ];
    }

    return [];
}

function appendRecordedRequiresBeforeBuilderAssertion(
    recordedAssertions: readonly RecordedAssertion[],
    recordIndex: number,
    builderAssertion: AssertionIdentity
): RecordedRequireMergeStep {
    let nextRecordIndex = recordIndex;
    const assertions: AssertionNode[] = [];

    while (nextRecordIndex < recordedAssertions.length) {
        const recorded = recordedAssertions[nextRecordIndex];

        if (recordContainsBuilderAssertion(recorded, builderAssertion)) {
            return { assertions, recordIndex: nextRecordIndex + 1 };
        }

        assertions.push(...requireAssertionsFromRecord(recorded));

        nextRecordIndex += 1;
    }

    return { assertions, recordIndex: nextRecordIndex };
}

function appendRemainingRecordedRequires(
    recordedAssertions: readonly RecordedAssertion[],
    recordIndex: number
): readonly AssertionNode[] {
    const assertions: AssertionNode[] = [];

    for (const recorded of recordedAssertions.slice(recordIndex)) {
        if (recorded.assertion?.source === 'require') {
            assertions.push(recorded.assertion);
        }
    }

    return assertions;
}

function mergeRecordedRequires(
    recordedAssertions: readonly RecordedAssertion[],
    returnedAssertions: readonly ReturnedAssertion[]
): readonly AssertionNode[] {
    const mergedAssertions: AssertionNode[] = [];
    let recordIndex = 0;

    for (const returnedAssertion of returnedAssertions) {
        const step = appendRecordedRequiresBeforeBuilderAssertion(
            recordedAssertions,
            recordIndex,
            returnedAssertion.original
        );
        recordIndex = step.recordIndex;
        mergedAssertions.push(
            ...step.assertions,
            capturedBuilderAssertion(returnedAssertion.original) ?? returnedAssertion.node
        );
    }

    mergedAssertions.push(...appendRemainingRecordedRequires(recordedAssertions, recordIndex));

    return mergedAssertions;
}

function recordedAssertionNodes(records: readonly RecordedAssertion[]): readonly AssertionNode[] {
    return records.flatMap(function toAssertion(recorded) {
        return recorded.assertion === null ? [] : [ recorded.assertion ];
    });
}

type BuilderAssertionSlot = AssertAssertionNode | typeof discardedAssertion | null;

function resolvedBuilderAssertions(slots: readonly BuilderAssertionSlot[]): readonly AssertAssertionNode[] {
    return slots.filter(function resolvedAssertion(assertion): assertion is AssertAssertionNode {
        return assertion !== null && assertion !== discardedAssertion;
    });
}

function collectBuilderAssertions(
    slots: readonly BuilderAssertionSlot[],
    failContract: AssertionRecording['failContract']
): NonEmptyReadonlyArray<AssertAssertionNode> {
    if (
        slots.every(function isDiscarded(assertion) {
            return assertion === discardedAssertion;
        })
    ) {
        failContract(createNoAssertionsFailure());
    }
    if (slots.includes(null)) {
        failContract(createPendingAsyncAssertionFailure());
    }
    const resolved = resolvedBuilderAssertions(slots);
    assertNonEmptyItems(resolved, 'Expected builder assertions to be non-empty.');
    return resolved;
}

function validateReturnedAssertions(
    slots: readonly BuilderAssertionSlot[],
    assertions: readonly ReturnedAssertion[],
    owner: AssertionReturnOwner,
    originals: OriginalNodes
): TestContractFailure | null {
    if (slots.includes(null)) {
        return createPendingAsyncAssertionFailure();
    }
    const ownershipFailure = returnedAssertionOwnershipFailure(assertions, owner, originals);
    if (ownershipFailure !== null) {
        return ownershipFailure;
    }
    return builderAssertionsInReturnedOrder(resolvedBuilderAssertions(slots), assertions)
        ? null
        : createDeadBuilderAssertionFailure();
}

function admitOnlyRecordedAssertion(
    value: unknown,
    active: readonly RecordedAssertion[],
    slots: readonly BuilderAssertionSlot[]
): readonly AssertionNode[] | null {
    const first = active[0];
    if (first === undefined || active.length !== 1 || slots.length !== 1) {
        return null;
    }
    return admitSingleRecordedReturn(value, first.builderAssertion, first.assertion);
}

function returnedAssertionNodes(
    assertionResult: unknown,
    active: readonly RecordedAssertion[],
    builderAssertions: readonly BuilderAssertionSlot[],
    owner: AssertionReturnOwner
): TestContractFailure | readonly AssertionNode[] {
    const admitted = admitReturnedAssertions(assertionResult);
    if (admitted.kind === 'rejected') {
        return admitted.failure;
    }
    const { assertions, originals } = admitted.value;
    const failure = validateReturnedAssertions(builderAssertions, assertions, owner, originals);
    if (failure !== null) {
        return failure;
    }
    return assertions.length === 0 ? createNoAssertionsFailure() : mergeRecordedRequires(active, assertions);
}

export function createAssertionRecorder(origin: AssertionOrigin): AssertionRecorder {
    const builderAssertions: BuilderAssertionSlot[] = [];
    const recordedAssertions: RecordedAssertion[] = [];
    const failures = new Set<TestContractFailure>();
    const property = createPropertyEvidenceRecorder();
    const { owner, lifetime } = createAssertionContext(origin, function retainFailure(failure) {
        failures.add(failure);
    });
    let failedRequireIndex: number | null = null;
    let plannedCount: number | null = null;

    function activeRecords(): readonly RecordedAssertion[] {
        if (failedRequireIndex === null) {
            return recordedAssertions;
        }

        return recordedAssertions.slice(0, failedRequireIndex + 1);
    }

    function failContract(failure: TestContractFailure): never {
        lifetime.assertRecording('record an assertion contract failure');
        return lifetime.fail(failure);
    }

    return {
        propertyEvidence: property.propertyEvidence,
        recordPropertyEvidence(evidence) {
            if (!lifetime.acceptsPropertyEvidence()) {
                return false;
            }
            property.recordPropertyEvidence(evidence);
            return true;
        },
        ...lifetime,
        activeRecordedAssertions() {
            return recordedAssertionNodes(activeRecords());
        },

        collect() {
            lifetime.assertRecording('collect assertions');
            return collectBuilderAssertions(builderAssertions, failContract);
        },

        completedThrowingAssertions() {
            if (builderAssertions.includes(null)) {
                return createPendingAsyncAssertionFailure();
            }

            return recordedAssertionNodes(activeRecords());
        },

        hasContractFailures() {
            return failures.size > 0;
        },

        contractFailures() {
            return Array.from(failures);
        },

        retainContractFailures(retained) {
            for (const failure of retained) {
                failures.add(failure);
            }
        },

        failContract,

        plan(count) {
            lifetime.assertRecording('set an assertion plan');
            if (
                !Number.isSafeInteger(count) || count <= 0 || plannedCount !== null ||
                recordedAssertions.length > 0
            ) {
                failContract(createInvalidPlanFailure(count));
            }

            recordDebugEntry('plan', count);
            plannedCount = count;
        },

        recordAssert(assertion) {
            lifetime.assertRecording('record an assertion');
            const admitted = requireRecordedAssertion(assertion, failContract);
            recordBuilderOwner(assertion, owner, admitted);
            recordDebugAssertion(admitted);
            builderAssertions.push(assertion);
            recordedAssertions.push({ assertion: admitted, builderAssertion: assertion });
            captureAssertion(admitted);
        },

        recordPendingAssert() {
            lifetime.assertRecording('start an asynchronous assertion');
            recordDebugEntry('assert', null);
            const builderIndex = builderAssertions.length;
            const recordIndex = recordedAssertions.length;

            builderAssertions.push(null);
            recordedAssertions.push({ assertion: null, builderAssertion: null });

            return {
                discard() {
                    lifetime.assertRecording('discard an asynchronous assertion');
                    builderAssertions[builderIndex] = discardedAssertion;
                },
                resolve(assertion) {
                    lifetime.assertRecording('finish an asynchronous assertion');
                    const admitted = admitRecordedAssertion(assertion, 'assert');
                    if (admitted.kind === 'rejected') {
                        builderAssertions[builderIndex] = discardedAssertion;
                        failContract(admitted.failure);
                    }
                    recordBuilderOwner(assertion, owner, admitted.value);
                    builderAssertions[builderIndex] = assertion;
                    recordedAssertions[recordIndex] = { assertion: admitted.value, builderAssertion: assertion };
                    captureAssertion(admitted.value);
                }
            };
        },

        recordRequire(assertion) {
            lifetime.assertRecording('record a requirement');
            const admitted = requireRecordedAssertion(assertion, failContract);
            recordDebugAssertion(admitted);
            const recordIndex = recordedAssertions.length;
            recordedAssertions.push({ assertion: admitted, builderAssertion: null });
            captureAssertion(admitted);

            if (!assertionPasses(admitted)) {
                failedRequireIndex = failedRequireIndex === null
                    ? recordIndex
                    : Math.min(failedRequireIndex, recordIndex);
                throw new RequireFailedSignalError();
            }
        },

        requireFailed() {
            return failedRequireIndex !== null;
        },

        returnedAssertions(assertionResult) {
            const active = activeRecords();
            const single = admitOnlyRecordedAssertion(assertionResult, active, builderAssertions);
            return single ?? returnedAssertionNodes(assertionResult, active, builderAssertions, {
                identity: owner,
                origin
            });
        },

        validateAssertionCount(reachedAssertionCount) {
            if (plannedCount !== null && plannedCount !== reachedAssertionCount) {
                return createPlanMismatchFailure(reachedAssertionCount, plannedCount);
            }

            return null;
        }
    };
}
