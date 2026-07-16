import { caseIdentityKey, createCaseId, formatCaseId, type CaseId } from './identity.ts';
import type { OrphanedNode } from './run-result.ts';
import {
    ensureOwnedTestNode,
    mergeMetadata,
    type Metadata,
    type Table,
    type TestBody,
    type TestCase,
    type TestNode,
    type TestNodeOwner
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
    readonly cases: readonly TestPlanCase[];
    readonly discoveredCases: readonly TestPlanCase[];
    readonly orphans: readonly OrphanedNode[];
};

export type TestPlanFactory = (root: TestNode) => TestPlan;

function collectTestCase(
    testCase: TestCase,
    reachedNodes: Set<TestNode>,
    suitePath: readonly string[],
    metadata: Metadata
): readonly TestPlanCase[] {
    reachedNodes.add(testCase);
    const resolvedMetadata = mergeMetadata(metadata, testCase.metadata);

    return [
        {
            body: testCase.body,
            id: createCaseId(suitePath, testCase.name, null),
            metadata: resolvedMetadata,
            suitePath
        }
    ];
}

function collectTable(
    table: Table,
    reachedNodes: Set<TestNode>,
    suitePath: readonly string[],
    metadata: Metadata
): readonly TestPlanCase[] {
    reachedNodes.add(table);
    const tablePath = [ ...suitePath, table.name ];
    const tableMetadata = mergeMetadata(metadata, table.metadata);

    return table.cases.map(function collectTableCase(tableCase): TestPlanCase {
        const resolvedMetadata = mergeMetadata(tableMetadata, tableCase.metadata);

        return {
            body: tableCase.body,
            id: createCaseId(tablePath, tableCase.name, null),
            metadata: resolvedMetadata,
            suitePath: tablePath
        };
    });
}

function collectNode(
    node: TestNode,
    reachedNodes: Set<TestNode>,
    suitePath: readonly string[],
    metadata: Metadata
): readonly TestPlanCase[] {
    if (node.kind === 'test') {
        return collectTestCase(node, reachedNodes, suitePath, metadata);
    }

    if (node.kind === 'table') {
        return collectTable(node, reachedNodes, suitePath, metadata);
    }

    reachedNodes.add(node);
    const childPath = [ ...suitePath, node.name ];
    const childMetadata = mergeMetadata(metadata, node.metadata);

    return node.children.flatMap(function collectChild(child) {
        return collectNode(child, reachedNodes, childPath, childMetadata);
    });
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

function createOrphanedNode(node: TestNode): OrphanedNode {
    return {
        file: null,
        kind: node.kind,
        name: node.name
    };
}

function collectOrphans(constructedNodes: ReadonlySet<TestNode>, reachedNodes: ReadonlySet<TestNode>): readonly OrphanedNode[] {
    const orphans: OrphanedNode[] = [];

    for (const node of constructedNodes) {
        if (!reachedNodes.has(node)) {
            orphans.push(createOrphanedNode(node));
        }
    }

    return orphans;
}

export function createTestPlanFactory(owner: TestNodeOwner, constructedNodes: ReadonlySet<TestNode>): TestPlanFactory {
    return function createTestPlan(root: TestNode): TestPlan {
        ensureOwnedTestNode(
            root,
            owner,
            'Test plan root must be an engine-created TestNode value.',
            'Test plan root must be created by the same engine instance.'
        );

        const reachedNodes = new Set<TestNode>();
        const discoveredCases = collectNode(root, reachedNodes, [], {});
        assertUniqueCaseIds(discoveredCases);

        return {
            cases: discoveredCases,
            defined: constructedNodes.size,
            discoveredCases,
            orphans: collectOrphans(constructedNodes, reachedNodes)
        };
    };
}
