const testNodeBrand: unique symbol = Symbol('OverkillTestNode');
const testNodeOwnerBrand: unique symbol = Symbol('OverkillTestNodeOwner');
const testCompletionBrand: unique symbol = Symbol('OverkillTestCompletion');

export type Metadata = Readonly<Record<string, unknown>>;

export type SourceLocation = {
    readonly column: number | null;
    readonly file: string;
    readonly line: number | null;
};

export type FailedCheck = {
    readonly actual: unknown;
    readonly expected: unknown;
    readonly id: string;
    readonly location: SourceLocation;
    readonly path: readonly (number | string)[];
    readonly summary: string;
};

export type AssertionFacade = {
    done: () => TestCompletion;
    equal: (actual: unknown, expected: unknown, summary: string) => TestCompletion;
    ok: (actual: unknown, summary: string) => TestCompletion;
};

export type TestContext = {
    readonly assert: AssertionFacade;
    readonly plan: (count: number) => TestCompletion;
    readonly require: AssertionFacade;
};

export type TestCompletion = {
    readonly [testCompletionBrand]: true;
};

export type TestBody = (testContext: TestContext) => Promise<TestCompletion | undefined> | TestCompletion | undefined;

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

export type TestNodeOwner = object;

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

export function createTestCompletion(): TestCompletion {
    return { [testCompletionBrand]: true };
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
