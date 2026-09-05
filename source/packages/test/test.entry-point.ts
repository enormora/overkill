import {
    captureSourceLocation,
    createSuite,
    createTable,
    createTestCase,
    type Metadata,
    type Suite,
    type Table,
    type TableOptions,
    type TestBody,
    type TestCase,
    type TestNode,
    type TestScope
} from '../engine/engine.entry-point.ts';

type UnavailableAuthoringApi = (...parameters: readonly unknown[]) => never;

type TestDefinition = {
    readonly body: TestBody;
    readonly metadata: Metadata;
    readonly title: string;
};

type RuntimeSuiteDefinition = {
    readonly children: readonly unknown[];
    readonly metadata: Metadata;
    readonly title: string;
};

export type ParameterizedTestScope<Row> = TestScope & {
    readonly parameters: Row;
};

export type TableTestBody<Row> = (
    scope: ParameterizedTestScope<Row>
) => ReturnType<TestBody>;

export type TableDefinition<Row> = {
    readonly caseTitle?: (parameters: Row, index: number) => string;
    readonly cases: readonly Row[];
    readonly metadata?: Metadata;
    readonly test: TableTestBody<Row>;
    readonly title: string;
};

type RuntimeTableDefinition<Row> = {
    readonly caseTitle: ((parameters: Row, index: number) => string) | null;
    readonly cases: readonly Row[];
    readonly metadata: Metadata;
    readonly test: TableTestBody<Row>;
    readonly title: string;
};

type TableCases = TableOptions['cases'];

const singleArgumentCount = 1;
const positionalArgumentCount = 2;
const testArgumentsError = 'test() requires (title, body) or ({ title, metadata, body }).';
const suiteArgumentsError = 'suite() requires (title, children) or ({ title, metadata, children }).';
const tableArgumentsError = 'table() requires ({ title, cases, metadata?, caseTitle?, test }).';

function createUnavailableAuthoringApi(name: string): UnavailableAuthoringApi {
    return function unavailableAuthoringApi(): never {
        throw new Error(`The @overkill-dev/test ${name}() authoring API is not implemented yet.`);
    };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertMetadataObject(value: unknown): asserts value is Metadata {
    if (!isRecord(value)) {
        throw new TypeError('Test node metadata must be an object.');
    }
}

function readRecord(value: unknown, message: string): Readonly<Record<string, unknown>> {
    if (!isRecord(value)) {
        throw new TypeError(message);
    }

    return value;
}

function readTitle(value: unknown, message: string): string {
    if (typeof value !== 'string') {
        throw new TypeError(message);
    }

    return value;
}

function isTestBody(value: unknown): value is TestBody {
    return typeof value === 'function';
}

function readBody(value: unknown): TestBody {
    if (!isTestBody(value)) {
        throw new TypeError('Test case body must be a function.');
    }

    return value;
}

function createMicrotestMetadata(value: unknown): Metadata {
    const metadata = isRecord(value) && !Object.hasOwn(value, 'kind')
        ? { ...value, kind: 'microtest' }
        : value;

    assertMetadataObject(metadata);

    return metadata;
}

function readChildren(value: unknown, message: string): readonly unknown[] {
    if (!Array.isArray(value)) {
        throw new TypeError(message);
    }

    const children: unknown[] = [];

    for (const child of value) {
        children.push(child);
    }

    return children;
}

function readTestDefinition(value: unknown): TestDefinition {
    const definition = readRecord(value, testArgumentsError);

    return {
        body: readBody(definition.body),
        metadata: createMicrotestMetadata(definition.metadata),
        title: readTitle(definition.title, testArgumentsError)
    };
}

function readSuiteDefinition(value: unknown): RuntimeSuiteDefinition {
    const definition = readRecord(value, suiteArgumentsError);

    return {
        children: readChildren(definition.children, suiteArgumentsError),
        metadata: createMicrotestMetadata(definition.metadata),
        title: readTitle(definition.title, suiteArgumentsError)
    };
}

function defaultCaseTitle(index: number): string {
    return `case ${index + 1}`;
}

function tableCaseTitle<Row>(
    caseTitle: ((parameters: Row, index: number) => string) | null,
    parameters: Row,
    index: number
): string {
    const title = caseTitle === null ? defaultCaseTitle(index) : caseTitle(parameters, index);

    if (typeof title !== 'string') {
        throw new TypeError('table() caseTitle must return a string.');
    }

    return title;
}

function tableCaseBody<Row>(
    definition: RuntimeTableDefinition<Row>,
    parameters: Row
): TestBody {
    return async function runTableCase(scope) {
        return await definition.test({ ...scope, parameters });
    };
}

function ensureTableDefinitionShape(definition: Readonly<Record<string, unknown>>): void {
    if (definition.caseTitle !== undefined && typeof definition.caseTitle !== 'function') {
        throw new TypeError(tableArgumentsError);
    }

    if (!Array.isArray(definition.cases)) {
        throw new TypeError(tableArgumentsError);
    }

    if (!isTestBody(definition.test)) {
        throw new TypeError('Test case body must be a function.');
    }
}

function readTableDefinition<Row>(definition: TableDefinition<Row>): RuntimeTableDefinition<Row> {
    const runtimeDefinition = readRecord(definition, tableArgumentsError);
    ensureTableDefinitionShape(runtimeDefinition);

    return {
        caseTitle: definition.caseTitle ?? null,
        cases: definition.cases,
        metadata: createMicrotestMetadata(runtimeDefinition.metadata ?? {}),
        test: definition.test,
        title: readTitle(runtimeDefinition.title, tableArgumentsError)
    };
}

function tableCases<Row>(
    definition: RuntimeTableDefinition<Row>
): TableCases {
    return definition.cases.map(function createTableCase(parameters, index) {
        return {
            body: tableCaseBody(definition, parameters),
            metadata: {},
            parameters,
            title: tableCaseTitle(definition.caseTitle, parameters, index)
        };
    });
}

export function test(
    ...input: readonly [definition: Readonly<Pick<TestCase, 'body' | 'metadata' | 'title'>>]
): TestCase;
export function test(...input: readonly [title: string, body: TestBody]): TestCase;
export function test(...input: readonly unknown[]): TestCase {
    if (input.length === singleArgumentCount) {
        const definition = readTestDefinition(input[0]);

        return createTestCase({
            body: definition.body,
            definitionLocation: captureSourceLocation()(),
            metadata: definition.metadata,
            title: definition.title
        });
    }

    if (input.length === positionalArgumentCount) {
        const [ name, body ] = input;

        return createTestCase({
            body: readBody(body),
            definitionLocation: captureSourceLocation()(),
            metadata: createMicrotestMetadata({}),
            title: readTitle(name, testArgumentsError)
        });
    }

    throw new TypeError(testArgumentsError);
}

export function suite(
    ...input: readonly [definition: Readonly<Pick<Suite, 'children' | 'metadata' | 'title'>>]
): Suite;
export function suite(...input: readonly [title: string, children: readonly TestNode[]]): Suite;
export function suite(...input: readonly unknown[]): Suite {
    if (input.length === singleArgumentCount) {
        const definition = readSuiteDefinition(input[0]);

        return createSuite({
            children: definition.children,
            definitionLocation: captureSourceLocation()(),
            metadata: definition.metadata,
            title: definition.title
        });
    }

    if (input.length === positionalArgumentCount) {
        const [ name, children ] = input;

        return createSuite({
            children: readChildren(children, suiteArgumentsError),
            definitionLocation: captureSourceLocation()(),
            metadata: createMicrotestMetadata({}),
            title: readTitle(name, suiteArgumentsError)
        });
    }

    throw new TypeError(suiteArgumentsError);
}

export function table<Row>(definition: TableDefinition<Row>): Table {
    const tableDefinition = readTableDefinition<Row>(definition);

    return createTable({
        cases: tableCases(tableDefinition),
        definitionLocation: captureSourceLocation()(),
        metadata: tableDefinition.metadata,
        title: tableDefinition.title
    });
}

export const createTestFacade = createUnavailableAuthoringApi('createTestFacade');
export const defineMacro = createUnavailableAuthoringApi('defineMacro');
export const runIfMain = createUnavailableAuthoringApi('runIfMain');

export type {
    Metadata,
    RunIfMainOptions,
    RunIfMainRootOptions,
    Suite,
    Table,
    TestBody,
    TestCase,
    TestNode,
    TestScope,
    TestScopeAssertContext
} from '../engine/engine.entry-point.ts';
