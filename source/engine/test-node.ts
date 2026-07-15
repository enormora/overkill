const testNodeBrand: unique symbol = Symbol('OverkillTestNode');
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
    readonly body: TestBody;
    readonly kind: 'test';
    readonly metadata: Metadata;
    readonly name: string;
};

export type Suite = {
    readonly [testNodeBrand]: true;
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
    readonly cases: readonly TableCase[];
    readonly kind: 'table';
    readonly metadata: Metadata;
    readonly name: string;
};

export type TestNode = Suite | Table | TestCase;

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

function ensureTestNode(value: unknown): asserts value is TestNode {
    if (!isTestNode(value)) {
        throw new TypeError('Suite children must be engine-created TestNode values.');
    }
}

function toTestNode(value: unknown): TestNode {
    ensureTestNode(value);
    return value;
}

export function createTestCase(options: TestCaseOptions): TestCase {
    ensureName(options.name);
    ensureMetadata(options.metadata);
    ensureTestBody(options.body);

    return {
        [testNodeBrand]: true,
        body: options.body,
        kind: 'test',
        metadata: options.metadata,
        name: options.name
    };
}

export function createSuite(options: SuiteOptions): Suite {
    ensureName(options.name);
    ensureMetadata(options.metadata);
    const children = options.children.map(toTestNode);

    return {
        [testNodeBrand]: true,
        children,
        kind: 'suite',
        metadata: options.metadata,
        name: options.name
    };
}

export function createTable(options: TableOptions): Table {
    ensureName(options.name);
    ensureMetadata(options.metadata);
    for (const tableCase of options.cases) {
        ensureName(tableCase.name);
        ensureMetadata(tableCase.metadata);
        ensureMetadata(tableCase.parameters);
        ensureTestBody(tableCase.body);
    }

    return {
        [testNodeBrand]: true,
        cases: options.cases,
        kind: 'table',
        metadata: options.metadata,
        name: options.name
    };
}

export function mergeMetadata(parent: Metadata, child: Metadata): Metadata {
    return { ...parent, ...child };
}
