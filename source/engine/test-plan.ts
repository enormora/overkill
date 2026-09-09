import type { NonEmptyReadonlyArray, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { caseIdentityKey, createCaseId, formatCaseId, type CaseId } from './identity.ts';
import {
    resolveRootTestAnnotations,
    resolveRootTestControls,
    resolveTestAnnotations,
    resolveTestControls,
    type TestAnnotations,
    type TestAnnotationsInput,
    type TestControls,
    type TestControlsInput,
    type TestFamily
} from './test-data.ts';
import type { OrphanedNode } from './run-result.ts';
import {
    ensureOwnedTestRoot,
    isOwnedTestNode,
    testNodeFamily,
    type RootOptions,
    type Suite,
    type Table,
    type TableCase,
    type TestBody,
    type TestCase,
    type TestCaseExecution,
    type TestNode,
    type TestNodeOwner,
    type TestRoot
} from './test-node.ts';

export type TestPlanCaseBody = TestBody;
export type TestPlanCaseExecution = TestCaseExecution;

export type TestPlanSuitePathEntry = {
    readonly definitionLocations: NonEmptyReadonlyArray<SourceLocation>;
    readonly title: string;
};

export type TestPlanCase = {
    readonly annotations: TestAnnotations;
    readonly controls: TestControls;
    readonly definitionLocations: NonEmptyReadonlyArray<SourceLocation>;
    readonly execution: TestPlanCaseExecution;
    readonly id: CaseId;
    readonly suitePath: readonly TestPlanSuitePathEntry[];
    readonly testFamily: TestFamily | null;
};

export type TestPlan = {
    readonly defined: number;
    readonly cases: NonEmptyReadonlyArray<TestPlanCase>;
    readonly discoveredCases: NonEmptyReadonlyArray<TestPlanCase>;
    readonly orphans: readonly OrphanedNode[];
    readonly root: TestPlanRoot;
};

type TestPlanRoot = {
    readonly annotations: TestAnnotations;
    readonly controls: TestControls;
    readonly title: string;
};

export type TestPlanFactory = (root: TestRoot) => TestPlan;

type TestPlanRootOptions = {
    readonly annotations: TestAnnotationsInput;
    readonly controls: TestControlsInput;
    readonly title: string;
};

export type TestPlanFromTestFilesOptions = {
    readonly files: NonEmptyReadonlyArray<{
        readonly file: string;
        readonly testNode: TestNode;
    }>;
    readonly root: TestPlanRootOptions;
};

export type TestPlanFromTestFilesFactory = (options: TestPlanFromTestFilesOptions) => TestPlan;
type FileBackedTestNodeInput = TestPlanFromTestFilesOptions['files'][number];

type CollectedTestCases = {
    readonly cases: readonly TestPlanCase[];
    readonly reachedNodes: readonly TestNode[];
};

type CollectionContext = {
    readonly annotations: TestAnnotations;
    readonly controls: TestControls;
    readonly file: string | null;
    readonly suitePath: readonly TestPlanSuitePathEntry[];
};

type TitledNode = {
    readonly title: string;
};

const minimumTableCaseCount = 2;

function parameterIdentity(parameters: TableCase['parameters']): string {
    return JSON.stringify(serializeValue(parameters));
}

function suiteTitles(suitePath: readonly TestPlanSuitePathEntry[]): readonly string[] {
    return suitePath.map(function toTitle(entry) {
        return entry.title;
    });
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectTestCase(
    testCase: TestCase,
    context: CollectionContext
): CollectedTestCases {
    const annotations = resolveTestAnnotations(context.annotations, testCase.annotations);
    const controls = resolveTestControls(context.controls, testCase.controls);

    return {
        cases: [
            {
                annotations,
                controls,
                definitionLocations: testCase.definitionLocations,
                execution: testCase.execution,
                id: createCaseId(context.file, suiteTitles(context.suitePath), testCase.title, null),
                suitePath: context.suitePath,
                testFamily: testNodeFamily(testCase)
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
            `Table must contain at least two cases: ${[ ...suiteTitles(context.suitePath), table.title ].join(' > ')}.`
        );
    }

    assertUniqueSiblingTitles(table.cases, [ ...suiteTitles(context.suitePath), table.title ]);

    const tablePath = [
        ...context.suitePath,
        { definitionLocations: table.definitionLocations, title: table.title }
    ];
    const tableAnnotations = resolveTestAnnotations(context.annotations, table.annotations);
    const tableControls = resolveTestControls(context.controls, table.controls);

    return {
        cases: table.cases.map(function collectTableCase(tableCase): TestPlanCase {
            const annotations = resolveTestAnnotations(tableAnnotations, tableCase.annotations);
            const controls = resolveTestControls(tableControls, tableCase.controls);

            return {
                annotations,
                controls,
                definitionLocations: table.definitionLocations,
                execution: { body: tableCase.body, kind: 'body' },
                id: createCaseId(
                    context.file,
                    suiteTitles(tablePath),
                    tableCase.title,
                    parameterIdentity(tableCase.parameters)
                ),
                suitePath: tablePath,
                testFamily: testNodeFamily(table)
            };
        }),
        reachedNodes: [ table ]
    };
}

function childCollectionContext(suite: Suite, context: CollectionContext): CollectionContext {
    return {
        annotations: resolveTestAnnotations(context.annotations, suite.annotations),
        controls: resolveTestControls(context.controls, suite.controls),
        file: context.file,
        suitePath: [
            ...context.suitePath,
            { definitionLocations: suite.definitionLocations, title: suite.title }
        ]
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
            `Suite must contain at least one child: ${[ ...suiteTitles(context.suitePath), node.title ].join(' > ')}.`
        );
    }

    assertUniqueSiblingTitles(node.children, [ ...suiteTitles(context.suitePath), node.title ]);

    const childContext = childCollectionContext(node, context);
    const children = mergeCollectedTestCases(node.children.map(function collectChild(child) {
        return collectNode(child, childContext);
    }));

    return {
        cases: children.cases,
        reachedNodes: [ node, ...children.reachedNodes ]
    };
}

function collectRoot(root: TestRoot, rootAnnotations: TestAnnotations, rootControls: TestControls): CollectedTestCases {
    if (root.children.length === 0) {
        throw new TypeError(`Root must contain at least one child: ${root.title}.`);
    }

    assertUniqueSiblingTitles(root.children, [ root.title ]);

    return mergeCollectedTestCases(root.children.map(function collectChild(child) {
        return collectNode(child, {
            annotations: rootAnnotations,
            controls: rootControls,
            file: null,
            suitePath: []
        });
    }));
}

function collectTestFiles(
    root: TestRoot,
    files: NonEmptyReadonlyArray<FileBackedTestNodeInput>,
    rootAnnotations: TestAnnotations,
    rootControls: TestControls
): CollectedTestCases {
    return mergeCollectedTestCases(root.children.map(function collectChild(child, index) {
        const file = files[index];

        if (file === undefined) {
            throw new TypeError('Every test file must map to one root child.');
        }

        return collectNode(child, {
            annotations: rootAnnotations,
            controls: rootControls,
            file: file.file,
            suitePath: []
        });
    }));
}

function toReachedNodeSet(reachedNodes: readonly TestNode[]): ReadonlySet<TestNode> {
    return new Set(reachedNodes);
}

function createOrphanedNode(node: TestNode): OrphanedNode {
    return {
        definitionLocations: node.definitionLocations,
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

        const rootAnnotations = resolveRootTestAnnotations(root.annotations);
        const rootControls = resolveRootTestControls(root.controls);
        const collection = collectRoot(root, rootAnnotations, rootControls);
        const { cases: discoveredCases, reachedNodes } = collection;
        assertNonEmptyCases(discoveredCases);
        assertUniqueCaseIds(discoveredCases);

        return {
            cases: discoveredCases,
            defined: constructedNodes.size,
            discoveredCases,
            orphans: collectOrphans(constructedNodes, reachedNodes),
            root: {
                annotations: rootAnnotations,
                controls: rootControls,
                title: root.title
            }
        };
    };
}

function assertKnownFileBackedNodeFields(file: Readonly<Record<string, unknown>>): void {
    const unknownField = Object.keys(file).find(function unknownFileBackedNodeField(field) {
        return field !== 'file' && field !== 'testNode';
    });

    if (unknownField !== undefined) {
        throw new TypeError(`Unknown test file field: ${unknownField}.`);
    }
}

function ensureFileBackedNodeInput(file: unknown, owner: TestNodeOwner): asserts file is FileBackedTestNodeInput {
    if (!isRecord(file)) {
        throw new TypeError('Test file input must be an object.');
    }

    assertKnownFileBackedNodeFields(file);

    if (typeof file.file !== 'string' || file.file.trim().length === 0) {
        throw new TypeError('Test file identity must not be empty.');
    }

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
            ensureFileBackedNodeInput(file, owner);
        }

        const root = createRoot({
            annotations: options.root.annotations,
            children: options.files.map(function toTestNode(file) {
                return file.testNode;
            }),
            controls: options.root.controls,
            title: options.root.title
        });
        const rootAnnotations = resolveRootTestAnnotations(root.annotations);
        const rootControls = resolveRootTestControls(root.controls);
        const { cases: discoveredCases, reachedNodes } = collectTestFiles(
            root,
            options.files,
            rootAnnotations,
            rootControls
        );
        assertNonEmptyCases(discoveredCases);
        assertUniqueCaseIds(discoveredCases);

        return {
            cases: discoveredCases,
            defined: countReachedNodes(reachedNodes),
            discoveredCases,
            orphans: [],
            root: {
                annotations: rootAnnotations,
                controls: rootControls,
                title: root.title
            }
        };
    };
}
