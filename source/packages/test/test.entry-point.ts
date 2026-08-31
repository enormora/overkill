import {
    captureSourceLocation,
    createSuite,
    createTestCase,
    type Metadata,
    type Suite,
    type TestBody,
    type TestCase,
    type TestNode
} from '../engine/engine.entry-point.ts';

type UnavailableAuthoringApi = (...parameters: readonly unknown[]) => never;

type TestDefinition = {
    readonly body: TestBody;
    readonly metadata: Metadata;
    readonly name: string;
};

type RuntimeSuiteDefinition = {
    readonly children: readonly unknown[];
    readonly metadata: Metadata;
    readonly name: string;
};

const singleArgumentCount = 1;
const positionalArgumentCount = 2;
const testArgumentsError = 'test() requires (name, body) or ({ name, metadata, body }).';
const suiteArgumentsError = 'suite() requires (name, children) or ({ name, metadata, children }).';

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

function readName(value: unknown, message: string): string {
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
        name: readName(definition.name, testArgumentsError)
    };
}

function readSuiteDefinition(value: unknown): RuntimeSuiteDefinition {
    const definition = readRecord(value, suiteArgumentsError);

    return {
        children: readChildren(definition.children, suiteArgumentsError),
        metadata: createMicrotestMetadata(definition.metadata),
        name: readName(definition.name, suiteArgumentsError)
    };
}

export function test(
    ...input: readonly [definition: Readonly<Pick<TestCase, 'body' | 'metadata' | 'name'>>]
): TestCase;
export function test(...input: readonly [name: string, body: TestBody]): TestCase;
export function test(...input: readonly unknown[]): TestCase {
    if (input.length === singleArgumentCount) {
        const definition = readTestDefinition(input[0]);

        return createTestCase({
            body: definition.body,
            definitionLocation: captureSourceLocation()(),
            metadata: definition.metadata,
            name: definition.name
        });
    }

    if (input.length === positionalArgumentCount) {
        const [ name, body ] = input;

        return createTestCase({
            body: readBody(body),
            definitionLocation: captureSourceLocation()(),
            metadata: createMicrotestMetadata({}),
            name: readName(name, testArgumentsError)
        });
    }

    throw new TypeError(testArgumentsError);
}

export function suite(
    ...input: readonly [definition: Readonly<Pick<Suite, 'children' | 'metadata' | 'name'>>]
): Suite;
export function suite(...input: readonly [name: string, children: readonly TestNode[]]): Suite;
export function suite(...input: readonly unknown[]): Suite {
    if (input.length === singleArgumentCount) {
        const definition = readSuiteDefinition(input[0]);

        return createSuite({
            children: definition.children,
            definitionLocation: captureSourceLocation()(),
            metadata: definition.metadata,
            name: definition.name
        });
    }

    if (input.length === positionalArgumentCount) {
        const [ name, children ] = input;

        return createSuite({
            children: readChildren(children, suiteArgumentsError),
            definitionLocation: captureSourceLocation()(),
            metadata: createMicrotestMetadata({}),
            name: readName(name, suiteArgumentsError)
        });
    }

    throw new TypeError(suiteArgumentsError);
}

export const createTestFacade = createUnavailableAuthoringApi('createTestFacade');
export const defineMacro = createUnavailableAuthoringApi('defineMacro');
export const runIfMain = createUnavailableAuthoringApi('runIfMain');
export const table = createUnavailableAuthoringApi('table');

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
