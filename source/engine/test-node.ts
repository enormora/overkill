import type {
    AssertAssertionNode,
    AssertionResult
} from '../assertion-protocol/assertion-node.ts';
import type { NonEmptyReadonlyArray, SourceLocation } from '../assertion-protocol/assertion-node-shape.ts';
import { ensureValidSourceLocation } from '../assertion-protocol/source-location.ts';
import type { AssertAssertionFacade } from './assertion-facade.ts';
import { ensureMetadata, type Metadata } from './metadata.ts';
import type { RequireAssertionFacade } from './require-assertion-facade.ts';

const testNodeBrand = Symbol.for('@overkill-dev/engine/TestNode');
const testRootBrand = Symbol.for('@overkill-dev/engine/TestRoot');
const testNodeOwnerBrand = Symbol.for('@overkill-dev/engine/TestNodeOwner');
const testNodeOwnerIdentity = Symbol.for('@overkill-dev/engine/TestNodeOwnerIdentity');
const defaultTestNodeOwnerKey = Symbol.for('@overkill-dev/engine/defaultTestNodeOwner');

export type TestScopeAssertContext = AssertAssertionFacade & {
    readonly collect: () => NonEmptyReadonlyArray<AssertAssertionNode>;
};

export type TestScope = {
    readonly assert: TestScopeAssertContext;
    readonly plan: (count: number) => void;
    readonly require: RequireAssertionFacade;
    readonly signal: AbortSignal;
};

export type TestBody = (scope: TestScope) => AssertionResult | Promise<AssertionResult>;

export type DefinitionLocations = NonEmptyReadonlyArray<SourceLocation>;

export type TestCase = {
    readonly [testNodeBrand]: true;
    readonly [testNodeOwnerBrand]: TestNodeOwner;
    readonly body: TestBody;
    readonly definitionLocations: DefinitionLocations;
    readonly kind: 'test';
    readonly metadata: Metadata;
    readonly title: string;
};

export type Suite = {
    readonly [testNodeBrand]: true;
    readonly [testNodeOwnerBrand]: TestNodeOwner;
    readonly children: readonly TestNode[];
    readonly definitionLocations: DefinitionLocations;
    readonly kind: 'suite';
    readonly metadata: Metadata;
    readonly title: string;
};

export type TableCase = {
    readonly body: TestBody;
    readonly metadata: Metadata;
    readonly parameters: unknown;
    readonly title: string;
};

export type Table = {
    readonly [testNodeBrand]: true;
    readonly [testNodeOwnerBrand]: TestNodeOwner;
    readonly cases: readonly TableCase[];
    readonly definitionLocations: DefinitionLocations;
    readonly kind: 'table';
    readonly metadata: Metadata;
    readonly title: string;
};

export type TestNode = Suite | Table | TestCase;

export type TestRoot = {
    readonly [testRootBrand]: true;
    readonly [testNodeOwnerBrand]: TestNodeOwner;
    readonly children: readonly TestNode[];
    readonly kind: 'root';
    readonly metadata: Metadata;
    readonly title: string;
};

export type TestNodeOwner = {
    readonly [testNodeOwnerIdentity]: true;
};

export type TestNodeFactory = {
    readonly createRoot: (options: RootOptions) => TestRoot;
    readonly createSuite: (options: SuiteOptions) => Suite;
    readonly createTable: (options: TableOptions) => Table;
    readonly createTestCase: (options: TestCaseOptions) => TestCase;
};

export type TestNodeFactoryOptions = {
    readonly owner: TestNodeOwner;
    readonly recordConstructedNode: (node: TestNode) => void;
};

export type TestCaseOptions = {
    readonly body: TestBody;
    readonly definitionLocations: DefinitionLocations;
    readonly metadata: Metadata;
    readonly title: string;
};

export type RootOptions = {
    readonly children: readonly unknown[];
    readonly metadata: Metadata;
    readonly title: string;
};

export type SuiteOptions = {
    readonly children: readonly unknown[];
    readonly definitionLocations: DefinitionLocations;
    readonly metadata: Metadata;
    readonly title: string;
};

export type TableCaseOptions = {
    readonly body: TestBody;
    readonly metadata: Metadata;
    readonly parameters: unknown;
    readonly title: string;
};

export type TableOptions = {
    readonly cases: readonly TableCaseOptions[];
    readonly definitionLocations: DefinitionLocations;
    readonly metadata: Metadata;
    readonly title: string;
};

export function createTestNodeOwner(): TestNodeOwner {
    return { [testNodeOwnerIdentity]: true };
}

function isTestNodeOwner(value: unknown): value is TestNodeOwner {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, testNodeOwnerIdentity);
}

export function defaultTestNodeOwner(): TestNodeOwner {
    const ownerStore = globalThis as Record<symbol, unknown> & typeof globalThis;
    const existingOwner = ownerStore[defaultTestNodeOwnerKey];

    if (isTestNodeOwner(existingOwner)) {
        return existingOwner;
    }

    const owner = createTestNodeOwner();
    ownerStore[defaultTestNodeOwnerKey] = owner;

    return owner;
}

function ensureTitle(title: string): void {
    if (title.trim().length === 0) {
        throw new TypeError('Test node title must not be empty.');
    }
}

function ensureTitleValue(title: unknown): asserts title is string {
    if (typeof title !== 'string') {
        throw new TypeError('Test node title must be a string.');
    }
}

function ensureTestBody(body: TestBody): void {
    if (typeof body !== 'function') {
        throw new TypeError('Test case body must be a function.');
    }
}

function ensureDefinitionLocations(definitionLocations: readonly SourceLocation[]): void {
    if (definitionLocations.length === 0) {
        throw new TypeError('Test node definition locations must contain at least one location.');
    }

    for (const location of definitionLocations) {
        ensureValidSourceLocation(location);
    }
}

export function isTestNode(value: unknown): value is TestNode {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, testNodeBrand);
}

export function isTestRoot(value: unknown): value is TestRoot {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, testRootBrand);
}

export function isOwnedTestNode(value: unknown, owner: TestNodeOwner): value is TestNode {
    return isTestNode(value) && value[testNodeOwnerBrand] === owner;
}

function hasTestNodeOwner(value: TestNode, owner: TestNodeOwner): boolean {
    return value[testNodeOwnerBrand] === owner;
}

function hasTestRootOwner(value: TestRoot, owner: TestNodeOwner): boolean {
    return value[testNodeOwnerBrand] === owner;
}

function ensureOwnedTestNode(
    value: unknown,
    owner: TestNodeOwner,
    plainObjectMessage: string,
    foreignNodeMessage: string
): asserts value is TestNode {
    if (!isTestNode(value)) {
        throw new TypeError(plainObjectMessage);
    }

    if (!hasTestNodeOwner(value, owner)) {
        throw new TypeError(foreignNodeMessage);
    }
}

export function ensureOwnedTestRoot(
    value: unknown,
    owner: TestNodeOwner,
    plainObjectMessage: string,
    foreignRootMessage: string
): asserts value is TestRoot {
    if (!isTestRoot(value)) {
        throw new TypeError(plainObjectMessage);
    }

    if (!hasTestRootOwner(value, owner)) {
        throw new TypeError(foreignRootMessage);
    }
}

function toTestNode(
    value: unknown,
    owner: TestNodeOwner,
    plainObjectMessage: string,
    foreignNodeMessage: string
): TestNode {
    ensureOwnedTestNode(
        value,
        owner,
        plainObjectMessage,
        foreignNodeMessage
    );
    return value;
}

export function createTestNodeFactory(factoryOptions: TestNodeFactoryOptions): TestNodeFactory {
    const { owner, recordConstructedNode } = factoryOptions;

    function createTestCase(options: TestCaseOptions): TestCase {
        ensureTitleValue(options.title);
        ensureTitle(options.title);
        ensureMetadata(options.metadata);
        ensureTestBody(options.body);
        ensureDefinitionLocations(options.definitionLocations);

        const testCase: TestCase = {
            [testNodeBrand]: true,
            [testNodeOwnerBrand]: owner,
            body: options.body,
            definitionLocations: options.definitionLocations,
            kind: 'test',
            metadata: options.metadata,
            title: options.title
        };

        recordConstructedNode(testCase);

        return testCase;
    }

    function createRoot(options: RootOptions): TestRoot {
        ensureTitleValue(options.title);
        ensureTitle(options.title);
        ensureMetadata(options.metadata);
        const children = options.children.map(function validateChild(child) {
            return toTestNode(
                child,
                owner,
                'Root children must be engine-created TestNode values.',
                'Root children must be created by the same engine instance.'
            );
        });

        return {
            [testRootBrand]: true,
            [testNodeOwnerBrand]: owner,
            children,
            kind: 'root',
            metadata: options.metadata,
            title: options.title
        };
    }

    function createSuite(options: SuiteOptions): Suite {
        ensureTitleValue(options.title);
        ensureTitle(options.title);
        ensureMetadata(options.metadata);
        ensureDefinitionLocations(options.definitionLocations);
        const children = options.children.map(function validateChild(child) {
            return toTestNode(
                child,
                owner,
                'Suite children must be engine-created TestNode values.',
                'Suite children must be created by the same engine instance.'
            );
        });

        const suite: Suite = {
            [testNodeBrand]: true,
            [testNodeOwnerBrand]: owner,
            children,
            definitionLocations: options.definitionLocations,
            kind: 'suite',
            metadata: options.metadata,
            title: options.title
        };

        recordConstructedNode(suite);

        return suite;
    }

    function ensureTableCases(cases: TableOptions['cases']): void {
        for (const tableCase of cases) {
            ensureTitleValue(tableCase.title);
            ensureTitle(tableCase.title);
            ensureMetadata(tableCase.metadata);
            ensureTestBody(tableCase.body);
        }
    }

    function createTable(options: TableOptions): Table {
        ensureTitleValue(options.title);
        ensureTitle(options.title);
        ensureMetadata(options.metadata);
        ensureDefinitionLocations(options.definitionLocations);
        ensureTableCases(options.cases);

        const table: Table = {
            [testNodeBrand]: true,
            [testNodeOwnerBrand]: owner,
            cases: options.cases,
            definitionLocations: options.definitionLocations,
            kind: 'table',
            metadata: options.metadata,
            title: options.title
        };

        recordConstructedNode(table);

        return table;
    }

    return {
        createRoot,
        createSuite,
        createTable,
        createTestCase
    };
}
