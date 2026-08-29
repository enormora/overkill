import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { caseIdentityKey, createCaseId, formatCaseId, type CaseId } from './identity.ts';
import {
    ensureMetadata,
    resolveMetadata,
    resolveRootMetadata,
    type Metadata,
    type ResolvedMetadata
} from './metadata.ts';
import type { OrphanedNode } from './run-result.ts';
import {
    ensureOwnedTestRoot,
    isOwnedTestNode,
    type RootOptions,
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
    readonly metadata: ResolvedMetadata;
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
    readonly metadata: ResolvedMetadata;
    readonly name: string;
};

export type TestPlanFactory = (root: TestRoot) => TestPlan;

export type TestPlanFile = {
    readonly file: string;
    readonly metadata: Metadata;
    readonly testNode: TestNode;
};

type TestPlanRootOptions = {
    readonly metadata: Metadata;
    readonly name: string;
};

export type TestPlanFromTestFilesOptions = {
    readonly files: NonEmptyReadonlyArray<TestPlanFile>;
    readonly root: TestPlanRootOptions;
};

export type TestPlanFromTestFilesFactory = (options: TestPlanFromTestFilesOptions) => TestPlan;

type CollectedTestCases = {
    readonly cases: readonly TestPlanCase[];
    readonly reachedNodes: readonly TestNode[];
};

function collectTestCase(
    testCase: TestCase,
    file: string | null,
    suitePath: readonly string[],
    metadata: ResolvedMetadata
): CollectedTestCases {
    const resolvedMetadata = resolveMetadata(metadata, testCase.metadata);

    return {
        cases: [
            {
                body: testCase.body,
                id: createCaseId(file, suitePath, testCase.name, null),
                metadata: resolvedMetadata,
                suitePath
            }
        ],
        reachedNodes: [ testCase ]
    };
}

function collectTable(
    table: Table,
    file: string | null,
    suitePath: readonly string[],
    metadata: ResolvedMetadata
): CollectedTestCases {
    if (table.cases.length === 0) {
        throw new TypeError(`Table must contain at least one case: ${[ ...suitePath, table.name ].join(' > ')}.`);
    }

    const tablePath = [ ...suitePath, table.name ];
    const tableMetadata = resolveMetadata(metadata, table.metadata);

    return {
        cases: table.cases.map(function collectTableCase(tableCase): TestPlanCase {
            const resolvedMetadata = resolveMetadata(tableMetadata, tableCase.metadata);

            return {
                body: tableCase.body,
                id: createCaseId(file, tablePath, tableCase.name, null),
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
    file: string | null,
    suitePath: readonly string[],
    metadata: ResolvedMetadata
): CollectedTestCases {
    if (node.kind === 'test') {
        return collectTestCase(node, file, suitePath, metadata);
    }

    if (node.kind === 'table') {
        return collectTable(node, file, suitePath, metadata);
    }

    if (node.children.length === 0) {
        throw new TypeError(`Suite must contain at least one child: ${[ ...suitePath, node.name ].join(' > ')}.`);
    }

    const childPath = [ ...suitePath, node.name ];
    const childMetadata = resolveMetadata(metadata, node.metadata);
    const children = mergeCollectedTestCases(node.children.map(function collectChild(child) {
        return collectNode(child, file, childPath, childMetadata);
    }));

    return {
        cases: children.cases,
        reachedNodes: [ node, ...children.reachedNodes ]
    };
}

function collectRoot(root: TestRoot, rootMetadata: ResolvedMetadata): CollectedTestCases {
    if (root.children.length === 0) {
        throw new TypeError(`Root must contain at least one child: ${root.name}.`);
    }

    return mergeCollectedTestCases(root.children.map(function collectChild(child) {
        return collectNode(child, null, [], rootMetadata);
    }));
}

function collectTestFiles(
    root: TestRoot,
    files: NonEmptyReadonlyArray<TestPlanFile>,
    rootMetadata: ResolvedMetadata
): CollectedTestCases {
    return mergeCollectedTestCases(root.children.map(function collectChild(child, index) {
        const file = files[index];

        if (file === undefined) {
            throw new TypeError('Every test file must map to one root child.');
        }

        return collectNode(child, file.file, [], resolveMetadata(rootMetadata, file.metadata));
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

        const rootMetadata = resolveRootMetadata(root.metadata);
        const collection = collectRoot(root, rootMetadata);
        const { cases: discoveredCases, reachedNodes } = collection;
        assertNonEmptyCases(discoveredCases);
        assertUniqueCaseIds(discoveredCases);

        return {
            cases: discoveredCases,
            defined: constructedNodes.size,
            discoveredCases,
            orphans: collectOrphans(constructedNodes, reachedNodes),
            root: {
                metadata: rootMetadata,
                name: root.name
            }
        };
    };
}

function ensureTestPlanFile(file: TestPlanFile, owner: TestNodeOwner): void {
    if (file.file.trim().length === 0) {
        throw new TypeError('Test file identity must not be empty.');
    }

    ensureMetadata(file.metadata);

    if (!isOwnedTestNode(file.testNode, owner)) {
        throw new TypeError('Test file must provide a TestNode created by the selected engine.');
    }
}

function countReachedNodes(reachedNodes: readonly TestNode[]): number {
    return reachedNodes.length;
}

export function createTestPlanFromTestFilesFactory(
    owner: TestNodeOwner,
    createRoot: (options: RootOptions) => TestRoot
): TestPlanFromTestFilesFactory {
    return function createTestPlanFromTestFiles(options): TestPlan {
        for (const file of options.files) {
            ensureTestPlanFile(file, owner);
        }

        const root = createRoot({
            children: options.files.map(function toTestNode(file) {
                return file.testNode;
            }),
            metadata: options.root.metadata,
            name: options.root.name
        });
        const rootMetadata = resolveRootMetadata(root.metadata);
        const { cases: discoveredCases, reachedNodes } = collectTestFiles(root, options.files, rootMetadata);
        assertNonEmptyCases(discoveredCases);
        assertUniqueCaseIds(discoveredCases);

        return {
            cases: discoveredCases,
            defined: countReachedNodes(reachedNodes),
            discoveredCases,
            orphans: [],
            root: {
                metadata: rootMetadata,
                name: root.name
            }
        };
    };
}
