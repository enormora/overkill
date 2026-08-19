import {
    assertionPasses
} from '../assertion-protocol/evaluation.ts';
import type {
    AssertAssertionNode,
    AssertionNode,
    AssertionResult,
    RequireAssertionNode
} from '../assertion-protocol/assertion-node.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { TestContractFailure } from './run-result.ts';

type RecordedAssertion = {
    readonly assertion: AssertionNode | null;
    readonly builderAssertion: AssertAssertionNode | null;
};

type RecordedRequireMergeStep = {
    readonly assertions: readonly AssertionNode[];
    readonly recordIndex: number;
};

type PendingRecordedAssert = {
    readonly resolve: (assertion: AssertAssertionNode) => void;
};

export type AssertionRecorder = {
    readonly activeRecordedAssertions: () => readonly AssertionNode[];
    readonly collect: () => NonEmptyReadonlyArray<AssertAssertionNode>;
    readonly failContract: (failure: TestContractFailure) => never;
    readonly plan: (count: number) => void;
    readonly recordAssert: (assertion: AssertAssertionNode) => void;
    readonly recordPendingAssert: () => PendingRecordedAssert;
    readonly recordRequire: (assertion: RequireAssertionNode) => void;
    readonly requireFailed: () => boolean;
    readonly returnedAssertions: (assertionResult: AssertionResult) => TestContractFailure | readonly AssertionNode[];
    readonly validateAssertionCount: (assertionCount: number) => TestContractFailure | null;
};

export class RequireFailedSignalError extends Error {
    public constructor() {
        super('Requirement failed.');
        this.name = 'RequireFailedSignalError';
    }
}

export class TestContractSignalError extends Error {
    private readonly contractFailure: TestContractFailure;

    public constructor(failure: TestContractFailure, options: Readonly<ErrorOptions> | undefined) {
        super(failure.summary, options);
        this.name = 'TestContractSignalError';
        this.contractFailure = failure;
    }

    public failure(): TestContractFailure {
        return this.contractFailure;
    }
}

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

function isAssertionNode(assertionResult: AssertionResult): assertionResult is AssertAssertionNode {
    return !Array.isArray(assertionResult);
}

function normalizeAssertionResult(assertionResult: AssertionResult): NonEmptyReadonlyArray<AssertAssertionNode> {
    const assertions = isAssertionNode(assertionResult) ? [ assertionResult ] : assertionResult;

    assertNonEmptyItems(assertions, 'Expected returned assertions to be non-empty.');

    return assertions;
}

function builderAssertionsInReturnedOrder(
    builderAssertions: readonly AssertAssertionNode[],
    returnedAssertions: readonly AssertAssertionNode[]
): boolean {
    let returnedIndex = 0;

    return builderAssertions.every(function builderAssertionReturned(builderAssertion) {
        while (returnedIndex < returnedAssertions.length) {
            const returnedAssertion = returnedAssertions[returnedIndex];
            returnedIndex += 1;

            if (returnedAssertion === builderAssertion) {
                return true;
            }
        }

        return false;
    });
}

function recordContainsBuilderAssertion(
    recorded: RecordedAssertion | undefined,
    builderAssertion: AssertAssertionNode
): recorded is RecordedAssertion {
    return recorded?.builderAssertion === builderAssertion;
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
    builderAssertion: AssertAssertionNode
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
    returnedAssertions: readonly AssertAssertionNode[]
): readonly AssertionNode[] {
    const mergedAssertions: AssertionNode[] = [];
    let recordIndex = 0;

    for (const returnedAssertion of returnedAssertions) {
        const step = appendRecordedRequiresBeforeBuilderAssertion(
            recordedAssertions,
            recordIndex,
            returnedAssertion
        );
        recordIndex = step.recordIndex;
        mergedAssertions.push(...step.assertions, returnedAssertion);
    }

    mergedAssertions.push(...appendRemainingRecordedRequires(recordedAssertions, recordIndex));

    return mergedAssertions;
}

export function createAssertionRecorder(): AssertionRecorder {
    const builderAssertions: (AssertAssertionNode | null)[] = [];
    const recordedAssertions: RecordedAssertion[] = [];
    let failedRequireIndex: number | null = null;
    let plannedCount: number | null = null;

    function activeRecords(): readonly RecordedAssertion[] {
        if (failedRequireIndex === null) {
            return recordedAssertions;
        }

        return recordedAssertions.slice(0, failedRequireIndex + 1);
    }

    function pendingAssertionExists(): boolean {
        return builderAssertions.includes(null);
    }

    function ensurePlanAllowed(count: number): void {
        if (!Number.isSafeInteger(count) || count <= 0 || plannedCount !== null || recordedAssertions.length > 0) {
            throw new TestContractSignalError(createInvalidPlanFailure(count), undefined);
        }
    }

    function collect(): NonEmptyReadonlyArray<AssertAssertionNode> {
        if (builderAssertions.length === 0) {
            throw new TestContractSignalError(createNoAssertionsFailure(), undefined);
        }

        if (pendingAssertionExists()) {
            throw new TestContractSignalError(createPendingAsyncAssertionFailure(), undefined);
        }

        const resolvedAssertions = builderAssertions.filter(function resolvedAssertion(
            assertion
        ): assertion is AssertAssertionNode {
            return assertion !== null;
        });

        assertNonEmptyItems(resolvedAssertions, 'Expected builder assertions to be non-empty.');

        return resolvedAssertions;
    }

    function validateReturnedAssertions(assertions: readonly AssertAssertionNode[]): TestContractFailure | null {
        if (pendingAssertionExists()) {
            return createPendingAsyncAssertionFailure();
        }

        const resolvedAssertions = builderAssertions.filter(function resolvedAssertion(
            assertion
        ): assertion is AssertAssertionNode {
            return assertion !== null;
        });

        if (!builderAssertionsInReturnedOrder(resolvedAssertions, assertions)) {
            return createDeadBuilderAssertionFailure();
        }

        return null;
    }

    return {
        activeRecordedAssertions() {
            return activeRecords().flatMap(function toAssertion(recorded) {
                return recorded.assertion === null ? [] : [ recorded.assertion ];
            });
        },

        collect,

        failContract(failure) {
            throw new TestContractSignalError(failure, undefined);
        },

        plan(count) {
            ensurePlanAllowed(count);
            plannedCount = count;
        },

        recordAssert(assertion) {
            builderAssertions.push(assertion);
            recordedAssertions.push({ assertion, builderAssertion: assertion });
        },

        recordPendingAssert() {
            const builderIndex = builderAssertions.length;
            const recordIndex = recordedAssertions.length;

            builderAssertions.push(null);
            recordedAssertions.push({ assertion: null, builderAssertion: null });

            return {
                resolve(assertion) {
                    builderAssertions[builderIndex] = assertion;
                    recordedAssertions[recordIndex] = { assertion, builderAssertion: assertion };
                }
            };
        },

        recordRequire(assertion) {
            recordedAssertions.push({ assertion, builderAssertion: null });

            if (!assertionPasses(assertion)) {
                failedRequireIndex = recordedAssertions.length - 1;
                throw new RequireFailedSignalError();
            }
        },

        requireFailed() {
            return failedRequireIndex !== null;
        },

        returnedAssertions(assertionResult) {
            const assertions = normalizeAssertionResult(assertionResult);
            const contractFailure = validateReturnedAssertions(assertions);

            if (contractFailure !== null) {
                return contractFailure;
            }

            return mergeRecordedRequires(activeRecords(), assertions);
        },

        validateAssertionCount(reachedAssertionCount) {
            if (plannedCount !== null && plannedCount !== reachedAssertionCount) {
                return createPlanMismatchFailure(reachedAssertionCount, plannedCount);
            }

            return null;
        }
    };
}
