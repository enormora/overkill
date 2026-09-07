import {
    captureSourceLocation,
    createSuite,
    createTable,
    createTestCase,
    forwardAssertionSourceLocations,
    type Metadata,
    type OutputRenderer,
    type Reporter,
    type NonEmptyReadonlyArray,
    ownsTestNode,
    type ResolvableSourceLocation,
    type SourceLocation,
    type Suite,
    type Table,
    type TableOptions,
    type TestBody,
    type TestCase,
    type TestNode,
    type TestScope
} from '../engine/engine.entry-point.ts';

type UnavailableAuthoringApi = (...parameters: readonly unknown[]) => never;

export type RunIfMainRootOptions = {
    readonly metadata: Metadata;
    readonly title: string;
};

export type RunIfMainOptions = {
    readonly outputRenderer?: OutputRenderer;
    readonly reporters?: readonly Reporter[];
    readonly root?: RunIfMainRootOptions;
};

export type RunIfMain = (
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: RunIfMainOptions
) => Promise<void>;

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
type MacroFactory<MacroParameters extends readonly unknown[], Node extends TestNode> = (
    ...parameters: MacroParameters
) => Node;
type ParameterizedTestBody<Data> = (
    scope: TestScope,
    data: Data
) => ReturnType<TestBody>;

const singleArgumentCount = 1;
const positionalArgumentCount = 2;
const testArgumentsError = 'test() requires (title, body) or ({ title, metadata, body }).';
const suiteArgumentsError = 'suite() requires (title, children) or ({ title, metadata, children }).';
const tableArgumentsError = 'table() requires ({ title, cases, metadata?, caseTitle?, test }).';
const activeMacroDefinitionLocations: NonEmptyReadonlyArray<SourceLocation>[] = [];

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

function captureAuthoringLocation(): SourceLocation {
    return captureSourceLocation()();
}

function currentMacroDefinitionLocations(): readonly SourceLocation[] {
    return activeMacroDefinitionLocations.at(-1) ?? [];
}

function sourceLocationsWithTrailingLocation<Location>(
    sourceLocations: readonly Location[],
    location: Location
): NonEmptyReadonlyArray<Location> {
    const firstLocation = sourceLocations[0];

    return firstLocation === undefined
        ? [ location ]
        : [ firstLocation, ...sourceLocations.slice(1), location ];
}

function definitionLocationsForAuthoringCall(): NonEmptyReadonlyArray<SourceLocation> {
    return sourceLocationsWithTrailingLocation(
        currentMacroDefinitionLocations(),
        captureAuthoringLocation()
    );
}

function runWithForwardedSourceLocations<Result>(
    sourceLocations: readonly ResolvableSourceLocation[],
    body: () => Result
): Result {
    const firstLocation = sourceLocations[0];

    return firstLocation === undefined
        ? body()
        : forwardAssertionSourceLocations([ firstLocation, ...sourceLocations.slice(1) ], body);
}

function assertionBodyForActiveMacro(body: TestBody): TestBody {
    const sourceLocations = currentMacroDefinitionLocations();

    if (sourceLocations.length === 0) {
        return body;
    }

    return async function runMacroGeneratedTestBody(scope) {
        return await runWithForwardedSourceLocations(sourceLocations, async function runBody() {
            return await body(scope);
        });
    };
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
    parameters: Row,
    sourceLocations: readonly SourceLocation[]
): TestBody {
    return async function runTableCase(scope) {
        return await runWithForwardedSourceLocations(sourceLocations, async function runMacroGeneratedTableCase() {
            return await definition.test({ ...scope, parameters });
        });
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
    const sourceLocations = currentMacroDefinitionLocations();

    return definition.cases.map(function createTableCase(parameters, index) {
        return {
            body: tableCaseBody(definition, parameters, sourceLocations),
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
            body: assertionBodyForActiveMacro(definition.body),
            definitionLocations: definitionLocationsForAuthoringCall(),
            metadata: definition.metadata,
            title: definition.title
        });
    }

    if (input.length === positionalArgumentCount) {
        const [ name, body ] = input;

        return createTestCase({
            body: assertionBodyForActiveMacro(readBody(body)),
            definitionLocations: definitionLocationsForAuthoringCall(),
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
            definitionLocations: definitionLocationsForAuthoringCall(),
            metadata: definition.metadata,
            title: definition.title
        });
    }

    if (input.length === positionalArgumentCount) {
        const [ name, children ] = input;

        return createSuite({
            children: readChildren(children, suiteArgumentsError),
            definitionLocations: definitionLocationsForAuthoringCall(),
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
        definitionLocations: definitionLocationsForAuthoringCall(),
        metadata: tableDefinition.metadata,
        title: tableDefinition.title
    });
}

export const createTestFacade = createUnavailableAuthoringApi('createTestFacade');

function createMacroNode<const MacroParameters extends readonly unknown[], Node extends TestNode>(
    factory: MacroFactory<MacroParameters, Node>,
    parameters: MacroParameters
): Node {
    const node = factory(...parameters);

    if (!ownsTestNode(node)) {
        throw new TypeError('defineMacro() factory must return a default-engine TestNode value.');
    }

    return node;
}

export function defineMacro<const MacroParameters extends readonly unknown[], Node extends TestNode>(
    factory: MacroFactory<MacroParameters, Node>
): MacroFactory<MacroParameters, Node> {
    if (typeof factory !== 'function') {
        throw new TypeError('defineMacro() requires a factory function.');
    }

    return function runMacro(...parameters) {
        const definitionLocations = definitionLocationsForAuthoringCall();

        activeMacroDefinitionLocations.push(definitionLocations);
        try {
            return createMacroNode(factory, parameters);
        } finally {
            activeMacroDefinitionLocations.pop();
        }
    };
}

export function defineParameterizedTestBody<Data>(
    body: ParameterizedTestBody<Data>
): (data: Data) => TestBody {
    if (typeof body !== 'function') {
        throw new TypeError('defineParameterizedTestBody() requires a body function.');
    }

    return function createParameterizedTestBody(data) {
        const sourceLocations: NonEmptyReadonlyArray<ResolvableSourceLocation> = [ captureAuthoringLocation() ];

        return async function runParameterizedTestBody(scope) {
            return forwardAssertionSourceLocations(sourceLocations, async function runBody() {
                return body(scope, data);
            });
        };
    };
}

export async function runIfMain(
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: RunIfMainOptions
): Promise<void> {
    if (!meta.main) {
        return;
    }

    const runModule = await import('../run/run.entry-point.ts');

    await runModule.runIfMain(meta, testNode, options);
}

export type {
    Metadata,
    OutputRenderer,
    Reporter,
    Suite,
    Table,
    TestBody,
    TestCase,
    TestNode,
    TestScope,
    TestScopeAssertContext
} from '../engine/engine.entry-point.ts';
