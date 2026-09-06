import type { NonEmptyReadonlyArray, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import { serializeValue } from '../compare/serialized-value.ts';
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
    type Suite,
    type Table,
    type TableCase,
    type TestBody,
    type TestCase,
    type TestNode,
    type TestNodeOwner,
    type TestRoot
} from './test-node.ts';

export type TestPlanCaseBody = TestBody;

export type TestPlanCase = {
    readonly body: TestPlanCaseBody;
    readonly definitionLocation: SourceLocation;
    readonly id: CaseId;
    readonly metadata: ResolvedMetadata;
    readonly suiteDefinitionLocations: readonly SourceLocation[];
    readonly suitePath: readonly string[];
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
    readonly title: string;
};

export type TestPlanFactory = (root: TestRoot) => TestPlan;

export type TestPlanFile = {
    readonly file: string;
    readonly metadata: Metadata;
    readonly testNode: TestNode;
};

type TestPlanRootOptions = {
    readonly metadata: Metadata;
    readonly title: string;
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

type CollectionContext = {
    readonly file: string | null;
    readonly metadata: ResolvedMetadata;
    readonly suiteDefinitionLocations: readonly SourceLocation[];
    readonly suitePath: readonly string[];
};

type TitledNode = {
    readonly title: string;
};

const minimumTableCaseCount = 2;

function parameterIdentity(parameters: TableCase['parameters']): string {
    return JSON.stringify(serializeValue(parameters));
}

function duplicateTitleMessage(title: string, path: readonly string[]): string {
    const location = path.length === 0 ? '<root>' : path.join(' > ');

    return `Duplicate test node title under ${location}: ${title}.`;
}

function assertUniqueSiblingTitles(nodes: readonly TitledNode[], path: readonly string[]): void {
    const seenTitles = new Set<string>();

    for (const node of nodes) {
        if (seenTitles.has(node.title)) {
            throw new TypeError(duplicateTitleMessage(node.title, path));
        }

        seenTitles.add(node.title);
    }
}

function collectTestCase(
    testCase: TestCase,
    context: CollectionContext
): CollectedTestCases {
    const resolvedMetadata = resolveMetadata(context.metadata, testCase.metadata);

    return {
        cases: [
            {
                body: testCase.body,
                definitionLocation: testCase.definitionLocation,
                id: createCaseId(context.file, context.suitePath, testCase.title, null),
                metadata: resolvedMetadata,
                suiteDefinitionLocations: context.suiteDefinitionLocations,
                suitePath: context.suitePath
            }
        ],
        reachedNodes: [ testCase ]
    };
}

function collectTable(
    table: Table,
    context: CollectionContext
): CollectedTestCases {
    if (table.cases.length < minimumTableCaseCount) {
        throw new TypeError(
            `Table must contain at least two cases: ${[ ...context.suitePath, table.title ].join(' > ')}.`
        );
    }

    assertUniqueSiblingTitles(table.cases, [ ...context.suitePath, table.title ]);

    const tablePath = [ ...context.suitePath, table.title ];
    const tablePathLocations = [ ...context.suiteDefinitionLocations, table.definitionLocation ];
    const tableMetadata = resolveMetadata(context.metadata, table.metadata);

    return {
        cases: table.cases.map(function collectTableCase(tableCase): TestPlanCase {
            const resolvedMetadata = resolveMetadata(tableMetadata, tableCase.metadata);

            return {
                body: tableCase.body,
                definitionLocation: table.definitionLocation,
                id: createCaseId(context.file, tablePath, tableCase.title, parameterIdentity(tableCase.parameters)),
                metadata: resolvedMetadata,
                suiteDefinitionLocations: tablePathLocations,
                suitePath: tablePath
            };
        }),
        reachedNodes: [ table ]
    };
}

function childCollectionContext(suite: Suite, context: CollectionContext): CollectionContext {
    return {
        file: context.file,
        metadata: resolveMetadata(context.metadata, suite.metadata),
        suiteDefinitionLocations: [ ...context.suiteDefinitionLocations, suite.definitionLocation ],
        suitePath: [ ...context.suitePath, suite.title ]
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
    context: CollectionContext
): CollectedTestCases {
    if (node.kind === 'test') {
        return collectTestCase(node, context);
    }

    if (node.kind === 'table') {
        return collectTable(node, context);
    }

    if (node.children.length === 0) {
        throw new TypeError(
            `Suite must contain at least one child: ${[ ...context.suitePath, node.title ].join(' > ')}.`
        );
    }

    assertUniqueSiblingTitles(node.children, [ ...context.suitePath, node.title ]);

    const childContext = childCollectionContext(node, context);
    const children = mergeCollectedTestCases(node.children.map(function collectChild(child) {
        return collectNode(child, childContext);
    }));

    return {
        cases: children.cases,
        reachedNodes: [ node, ...children.reachedNodes ]
    };
}

function collectRoot(root: TestRoot, rootMetadata: ResolvedMetadata): CollectedTestCases {
    if (root.children.length === 0) {
        throw new TypeError(`Root must contain at least one child: ${root.title}.`);
    }

    assertUniqueSiblingTitles(root.children, [ root.title ]);

    return mergeCollectedTestCases(root.children.map(function collectChild(child) {
        return collectNode(child, {
            file: null,
            metadata: rootMetadata,
            suiteDefinitionLocations: [],
            suitePath: []
        });
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

        return collectNode(child, {
            file: file.file,
            metadata: resolveMetadata(rootMetadata, file.metadata),
            suiteDefinitionLocations: [],
            suitePath: []
        });
    }));
}

function toReachedNodeSet(reachedNodes: readonly TestNode[]): ReadonlySet<TestNode> {
    return new Set(reachedNodes);
}

function createOrphanedNode(node: TestNode): OrphanedNode {
    return {
        definitionLocation: node.definitionLocation,
        file: null,
        kind: node.kind,
        title: node.title
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
                title: root.title
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
            title: options.root.title
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
                title: root.title
            }
        };
    };
}
