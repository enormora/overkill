import type {
    AssertAssertionNode,
    AssertionResult
} from '../assertion-protocol/assertion-node.ts';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type { AssertAssertionFacade } from './assertion-facade.ts';
import type { RequireAssertionFacade } from './require-assertion-facade.ts';

const testNodeBrand: unique symbol = Symbol('OverkillTestNode');
const testNodeOwnerBrand: unique symbol = Symbol('OverkillTestNodeOwner');
const testNodeOwnerIdentity: unique symbol = Symbol('OverkillTestNodeOwnerIdentity');

export type Metadata = Readonly<Record<string, unknown>>;

export type CaseAssertContext = AssertAssertionFacade & {
    readonly done: () => NonEmptyReadonlyArray<AssertAssertionNode>;
};

export type TestContext = {
    readonly assert: CaseAssertContext;
    readonly plan: (count: number) => void;
    readonly require: RequireAssertionFacade;
};

export type TestBody = (testContext: TestContext) => AssertionResult | Promise<AssertionResult>;

export type TestCase = {
    readonly [testNodeBrand]: true;
    readonly [testNodeOwnerBrand]: TestNodeOwner;
    readonly body: TestBody;
    readonly kind: 'test';
    readonly metadata: Metadata;
    readonly name: string;
};

export type Suite = {
    readonly [testNodeBrand]: true;
    readonly [testNodeOwnerBrand]: TestNodeOwner;
    readonly children: readonly TestNode[];
    readonly kind: 'suite';
    readonly metadata: Metadata;
    readonly name: string;
};

export type TableCase = {
    readonly body: TestBody;
    readonly metadata: Metadata;
    readonly name: string;
    readonly parameters: Readonly<Record<string, unknown>>;
};

export type Table = {
    readonly [testNodeBrand]: true;
    readonly [testNodeOwnerBrand]: TestNodeOwner;
    readonly cases: readonly TableCase[];
    readonly kind: 'table';
    readonly metadata: Metadata;
    readonly name: string;
};

export type TestNode = Suite | Table | TestCase;

export type TestNodeOwner = {
    readonly [testNodeOwnerIdentity]: true;
};

export type TestNodeFactory = {
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
    readonly metadata: Metadata;
    readonly name: string;
};

export type SuiteOptions = {
    readonly children: readonly unknown[];
    readonly metadata: Metadata;
    readonly name: string;
};

export type TableCaseOptions = {
    readonly body: TestBody;
    readonly metadata: Metadata;
    readonly name: string;
    readonly parameters: Readonly<Record<string, unknown>>;
};

export type TableOptions = {
    readonly cases: readonly TableCaseOptions[];
    readonly metadata: Metadata;
    readonly name: string;
};

export function createTestNodeOwner(): TestNodeOwner {
    return { [testNodeOwnerIdentity]: true };
}

function ensureName(name: string): void {
    if (name.trim().length === 0) {
        throw new TypeError('Test node name must not be empty.');
    }
}

function ensureMetadata(metadata: unknown): asserts metadata is Metadata {
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
        throw new TypeError('Test node metadata must be an object.');
    }
}

function ensureTestBody(body: TestBody): void {
    if (typeof body !== 'function') {
        throw new TypeError('Test case body must be a function.');
    }
}

export function isTestNode(value: unknown): value is TestNode {
    return typeof value === 'object' && value !== null && Object.hasOwn(value, testNodeBrand);
}

function hasTestNodeOwner(value: TestNode, owner: TestNodeOwner): boolean {
    return value[testNodeOwnerBrand] === owner;
}

export function ensureOwnedTestNode(
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

function toTestNode(value: unknown, owner: TestNodeOwner): TestNode {
    ensureOwnedTestNode(
        value,
        owner,
        'Suite children must be engine-created TestNode values.',
        'Suite children must be created by the same engine instance.'
    );
    return value;
}

export function createTestNodeFactory(factoryOptions: TestNodeFactoryOptions): TestNodeFactory {
    const { owner, recordConstructedNode } = factoryOptions;

    function createTestCase(options: TestCaseOptions): TestCase {
        ensureName(options.name);
        ensureMetadata(options.metadata);
        ensureTestBody(options.body);

        const testCase: TestCase = {
            [testNodeBrand]: true,
            [testNodeOwnerBrand]: owner,
            body: options.body,
            kind: 'test',
            metadata: options.metadata,
            name: options.name
        };

        recordConstructedNode(testCase);

        return testCase;
    }

    function createSuite(options: SuiteOptions): Suite {
        ensureName(options.name);
        ensureMetadata(options.metadata);
        const children = options.children.map(function validateChild(child) {
            return toTestNode(child, owner);
        });

        const suite: Suite = {
            [testNodeBrand]: true,
            [testNodeOwnerBrand]: owner,
            children,
            kind: 'suite',
            metadata: options.metadata,
            name: options.name
        };

        recordConstructedNode(suite);

        return suite;
    }

    function createTable(options: TableOptions): Table {
        ensureName(options.name);
        ensureMetadata(options.metadata);
        for (const tableCase of options.cases) {
            ensureName(tableCase.name);
            ensureMetadata(tableCase.metadata);
            ensureMetadata(tableCase.parameters);
            ensureTestBody(tableCase.body);
        }

        const table: Table = {
            [testNodeBrand]: true,
            [testNodeOwnerBrand]: owner,
            cases: options.cases,
            kind: 'table',
            metadata: options.metadata,
            name: options.name
        };

        recordConstructedNode(table);

        return table;
    }

    return {
        createSuite,
        createTable,
        createTestCase
    };
}

export function mergeMetadata(parent: Metadata, child: Metadata): Metadata {
    return { ...parent, ...child };
}
