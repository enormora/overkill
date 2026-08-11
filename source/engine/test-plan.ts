import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { caseIdentityKey, createCaseId, formatCaseId, type CaseId } from './identity.ts';
import type { OrphanedNode } from './run-result.ts';
import {
    ensureOwnedTestRoot,
    mergeMetadata,
    type Metadata,
    type Table,
    type TestBody,
    type TestCase,
    type TestNode,
    type TestNodeOwner,
    type TestRoot
} from './test-node.ts';

export type TestPlanCaseBody = TestBody;

export type TestPlanCase = {
    readonly id: CaseId;
    readonly suitePath: readonly string[];
    readonly metadata: Metadata;
    readonly body: TestPlanCaseBody;
};

export type TestPlan = {
    readonly defined: number;
    readonly cases: NonEmptyReadonlyArray<TestPlanCase>;
    readonly discoveredCases: NonEmptyReadonlyArray<TestPlanCase>;
    readonly orphans: readonly OrphanedNode[];
    readonly root: TestPlanRoot;
};

type TestPlanRoot = {
    readonly metadata: Metadata;
    readonly name: string;
};

export type TestPlanFactory = (root: TestRoot) => TestPlan;

type CollectedTestCases = {
    readonly cases: readonly TestPlanCase[];
    readonly reachedNodes: readonly TestNode[];
};

function collectTestCase(
    testCase: TestCase,
    suitePath: readonly string[],
    metadata: Metadata
): CollectedTestCases {
    const resolvedMetadata = mergeMetadata(metadata, testCase.metadata);

    return {
        cases: [
            {
                body: testCase.body,
                id: createCaseId(suitePath, testCase.name, null),
                metadata: resolvedMetadata,
                suitePath
            }
        ],
        reachedNodes: [ testCase ]
    };
}

function collectTable(
    table: Table,
    suitePath: readonly string[],
    metadata: Metadata
): CollectedTestCases {
    if (table.cases.length === 0) {
        throw new TypeError(`Table must contain at least one case: ${[ ...suitePath, table.name ].join(' > ')}.`);
    }

    const tablePath = [ ...suitePath, table.name ];
    const tableMetadata = mergeMetadata(metadata, table.metadata);

    return {
        cases: table.cases.map(function collectTableCase(tableCase): TestPlanCase {
            const resolvedMetadata = mergeMetadata(tableMetadata, tableCase.metadata);

            return {
                body: tableCase.body,
                id: createCaseId(tablePath, tableCase.name, null),
                metadata: resolvedMetadata,
                suitePath: tablePath
            };
        }),
        reachedNodes: [ table ]
    };
}

function mergeCollectedTestCases(collections: readonly CollectedTestCases[]): CollectedTestCases {
    return {
        cases: collections.flatMap(function collectCases(collection) {
            return collection.cases;
        }),
        reachedNodes: collections.flatMap(function collectReachedNodes(collection) {
            return collection.reachedNodes;
        })
    };
}

function collectNode(
    node: TestNode,
    suitePath: readonly string[],
    metadata: Metadata
): CollectedTestCases {
    if (node.kind === 'test') {
        return collectTestCase(node, suitePath, metadata);
    }

    if (node.kind === 'table') {
        return collectTable(node, suitePath, metadata);
    }

    if (node.children.length === 0) {
        throw new TypeError(`Suite must contain at least one child: ${[ ...suitePath, node.name ].join(' > ')}.`);
    }

    const childPath = [ ...suitePath, node.name ];
    const childMetadata = mergeMetadata(metadata, node.metadata);
    const children = mergeCollectedTestCases(node.children.map(function collectChild(child) {
        return collectNode(child, childPath, childMetadata);
    }));

    return {
        cases: children.cases,
        reachedNodes: [ node, ...children.reachedNodes ]
    };
}

function collectRoot(root: TestRoot): CollectedTestCases {
    if (root.children.length === 0) {
        throw new TypeError(`Root must contain at least one child: ${root.name}.`);
    }

    return mergeCollectedTestCases(root.children.map(function collectChild(child) {
        return collectNode(child, [], root.metadata);
    }));
}

function toReachedNodeSet(reachedNodes: readonly TestNode[]): ReadonlySet<TestNode> {
    return new Set(reachedNodes);
}

function createOrphanedNode(node: TestNode): OrphanedNode {
    return {
        file: null,
        kind: node.kind,
        name: node.name
    };
}

function collectOrphans(
    constructedNodes: ReadonlySet<TestNode>,
    reachedNodes: readonly TestNode[]
): readonly OrphanedNode[] {
    const reachedNodeSet = toReachedNodeSet(reachedNodes);

    return Array
        .from(constructedNodes)
        .filter(function isOrphan(node) {
            return !reachedNodeSet.has(node);
        })
        .map(createOrphanedNode);
}

function assertUniqueCaseIds(cases: readonly TestPlanCase[]): void {
    const seenCaseIds = new Set<string>();

    for (const testCase of cases) {
        const key = caseIdentityKey(testCase.id);

        if (seenCaseIds.has(key)) {
            throw new TypeError(`Duplicate test case identity: ${formatCaseId(testCase.id)}.`);
        }

        seenCaseIds.add(key);
    }
}

function assertNonEmptyCases(cases: readonly TestPlanCase[]): asserts cases is NonEmptyReadonlyArray<TestPlanCase> {
    if (cases.length === 0) {
        throw new TypeError('Test plan must contain at least one executable test case.');
    }
}

export function createTestPlanFactory(owner: TestNodeOwner, constructedNodes: ReadonlySet<TestNode>): TestPlanFactory {
    return function createTestPlan(root: TestRoot): TestPlan {
        ensureOwnedTestRoot(
            root,
            owner,
            'Test plan root must be an engine-created TestRoot value.',
            'Test plan root must be created by the same engine instance.'
        );

        const collection = collectRoot(root);
        const { cases: discoveredCases, reachedNodes } = collection;
        assertNonEmptyCases(discoveredCases);
        assertUniqueCaseIds(discoveredCases);

        return {
            cases: discoveredCases,
            defined: constructedNodes.size,
            discoveredCases,
            orphans: collectOrphans(constructedNodes, reachedNodes),
            root: {
                metadata: root.metadata,
                name: root.name
            }
        };
    };
}
