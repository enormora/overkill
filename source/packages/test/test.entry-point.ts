import {
    createSuite,
    createTable,
    createTestCase,
    type DefinedOutputRenderer,
    type DefinedReporter,
    type Metadata,
    type SourceLocation,
    ownsTestNode,
    type Suite,
    type Table,
    type TableOptions,
    type TestBody,
    type TestCase,
    type TestFamily,
    type TestNode,
    type TestScope
} from '../engine/engine.entry-point.ts';
import {
    activeMacroSourceLocations,
    assertionBodyForActiveMacro,
    defineParameterizedTestBodyFactory,
    definitionLocationsForAuthoringCall,
    runWithForwardedSourceLocations,
    runMacroWithDefinitionLocations
} from './authoring-source-locations.ts';
import {
    createAuthoringMetadata,
    readAuthoringMetadata,
    readTestFacadeDefinition,
    type AuthoringMetadata,
    type TestFacadeDefinition
} from './authoring-metadata.ts';

export {
    doubleUsage,
    rule,
    testAsyncDisposable,
    testAsyncIterable,
    testAsyncIterator,
    testDisposable,
    testDouble,
    testIterable,
    testIterator
} from '../doubles/doubles.entry-point.ts';
export type {
    AsyncDisposableConfiguration,
    AsyncIterableConfiguration,
    AsyncIteratorConfiguration,
    AsyncIteratorSource,
    DisposableConfiguration,
    DoubleCall,
    DoubleConstruction,
    DoubleHistory,
    DoubleInteraction,
    DoubleInvocation,
    DoubleIteratorEvent,
    DoubleIteratorReturnEvent,
    DoubleIteratorThrowEvent,
    DoubleIteratorYieldEvent,
    DoubleResult,
    DoubleReturnedResult,
    DoubleThrownResult,
    DoubleUsageAssertions,
    ProtocolMethodConfiguration,
    RuleFactory,
    SyncIterableConfiguration,
    SyncIteratorConfiguration,
    SyncIteratorSource,
    TestAsyncDisposable,
    TestAsyncDisposableFactory,
    TestAsyncIterable,
    TestAsyncIterableFactory,
    TestAsyncIterator,
    TestAsyncIteratorFactory,
    TestDisposable,
    TestDisposableFactory,
    TestDouble,
    TestDoubleFactory,
    TestIterable,
    TestIterableFactory,
    TestIterator,
    TestIteratorFactory
} from '../doubles/doubles.entry-point.ts';

export type { AuthoringMetadata, TestFacadeDefinition } from './authoring-metadata.ts';

export type RunIfMainRootOptions = {
    readonly metadata: AuthoringMetadata;
    readonly title: string;
};

export type RunIfMainOptions = {
    readonly outputRenderer?: DefinedOutputRenderer;
    readonly reporters?: readonly DefinedReporter[];
    readonly root?: RunIfMainRootOptions;
};

export type RunIfMain = (
    meta: Readonly<ImportMeta>,
    testNode: TestNode,
    options?: RunIfMainOptions
) => Promise<void>;

type TestDefinition = {
    readonly body: TestBody;
    readonly metadata: AuthoringMetadata;
    readonly title: string;
};

type RuntimeTestDefinition = {
    readonly body: TestBody;
    readonly metadata: Metadata;
    readonly title: string;
};

type SuiteDefinition = {
    readonly children: readonly TestNode[];
    readonly metadata: AuthoringMetadata;
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
    readonly metadata?: AuthoringMetadata;
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
type ParameterizedTestBody<Data> = (scope: TestScope, data: Data) => ReturnType<TestBody>;
type TestAuthor = (
    ...input: readonly [definition: Readonly<TestDefinition>] | readonly [title: string, body: TestBody]
) => TestCase;
type SuiteAuthor = (
    ...input: readonly [definition: Readonly<SuiteDefinition>] | readonly [title: string, children: readonly TestNode[]]
) => Suite;
type TableAuthor = <Row>(definition: TableDefinition<Row>) => Table;

export type TestFacade = {
    readonly defineMacro: typeof defineMacro;
    readonly defineParameterizedTestBody: typeof defineParameterizedTestBody;
    readonly runIfMain: RunIfMain;
    readonly suite: SuiteAuthor;
    readonly table: TableAuthor;
    readonly test: TestAuthor;
};

const singleArgumentCount = 1;
const positionalArgumentCount = 2;
const testArgumentsError = 'test() requires (title, body) or ({ title, metadata, body }).';
const suiteArgumentsError = 'suite() requires (title, children) or ({ title, metadata, children }).';
const tableArgumentsError = 'table() requires ({ title, cases, metadata?, caseTitle?, test }).';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function readTestDefinition(value: unknown): RuntimeTestDefinition {
    const definition = readRecord(value, testArgumentsError);

    return {
        body: readBody(definition.body),
        metadata: readAuthoringMetadata(definition.metadata),
        title: readTitle(definition.title, testArgumentsError)
    };
}

function readSuiteDefinition(value: unknown): RuntimeSuiteDefinition {
    const definition = readRecord(value, suiteArgumentsError);

    return {
        children: readChildren(definition.children, suiteArgumentsError),
        metadata: readAuthoringMetadata(definition.metadata),
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
        metadata: readAuthoringMetadata(runtimeDefinition.metadata ?? {}),
        test: definition.test,
        title: readTitle(runtimeDefinition.title, tableArgumentsError)
    };
}

function tableCases<Row>(
    definition: RuntimeTableDefinition<Row>
): TableCases {
    const sourceLocations = activeMacroSourceLocations();

    return definition.cases.map(function createTableCase(parameters, index) {
        return {
            body: tableCaseBody(definition, parameters, sourceLocations),
            metadata: {},
            parameters,
            title: tableCaseTitle(definition.caseTitle, parameters, index)
        };
    });
}

function createAuthoredTest(
    testFamily: TestFamily,
    facadeMetadata: Metadata,
    ...input: readonly unknown[]
): TestCase {
    if (input.length === singleArgumentCount) {
        const definition = readTestDefinition(input[0]);

        return createTestCase({
            body: assertionBodyForActiveMacro(definition.body),
            definitionLocations: definitionLocationsForAuthoringCall(),
            metadata: createAuthoringMetadata(testFamily, facadeMetadata, definition.metadata),
            title: definition.title
        });
    }

    if (input.length === positionalArgumentCount) {
        const [ name, body ] = input;

        return createTestCase({
            body: assertionBodyForActiveMacro(readBody(body)),
            definitionLocations: definitionLocationsForAuthoringCall(),
            metadata: createAuthoringMetadata(testFamily, facadeMetadata, {}),
            title: readTitle(name, testArgumentsError)
        });
    }

    throw new TypeError(testArgumentsError);
}

export function test(...input: readonly [definition: Readonly<TestDefinition>]): TestCase;
export function test(...input: readonly [title: string, body: TestBody]): TestCase;
export function test(...input: readonly unknown[]): TestCase {
    return createAuthoredTest('microtest', {}, ...input);
}

function createAuthoredSuite(
    testFamily: TestFamily,
    facadeMetadata: Metadata,
    ...input: readonly unknown[]
): Suite {
    if (input.length === singleArgumentCount) {
        const definition = readSuiteDefinition(input[0]);

        return createSuite({
            children: definition.children,
            definitionLocations: definitionLocationsForAuthoringCall(),
            metadata: createAuthoringMetadata(testFamily, facadeMetadata, definition.metadata),
            title: definition.title
        });
    }

    if (input.length === positionalArgumentCount) {
        const [ name, children ] = input;

        return createSuite({
            children: readChildren(children, suiteArgumentsError),
            definitionLocations: definitionLocationsForAuthoringCall(),
            metadata: createAuthoringMetadata(testFamily, facadeMetadata, {}),
            title: readTitle(name, suiteArgumentsError)
        });
    }

    throw new TypeError(suiteArgumentsError);
}

export function suite(...input: readonly [definition: Readonly<SuiteDefinition>]): Suite;
export function suite(...input: readonly [title: string, children: readonly TestNode[]]): Suite;
export function suite(...input: readonly unknown[]): Suite {
    return createAuthoredSuite('microtest', {}, ...input);
}

function createAuthoredTable<Row>(
    testFamily: TestFamily,
    facadeMetadata: Metadata,
    definition: TableDefinition<Row>
): Table {
    const tableDefinition = readTableDefinition<Row>(definition);

    return createTable({
        cases: tableCases(tableDefinition),
        definitionLocations: definitionLocationsForAuthoringCall(),
        metadata: createAuthoringMetadata(testFamily, facadeMetadata, tableDefinition.metadata),
        title: tableDefinition.title
    });
}

export function table<Row>(definition: TableDefinition<Row>): Table {
    return createAuthoredTable('microtest', {}, definition);
}

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
        return runMacroWithDefinitionLocations(function createNode() {
            return createMacroNode(factory, parameters);
        });
    };
}

export function defineParameterizedTestBody<Data>(
    body: ParameterizedTestBody<Data>
): (data: Data) => TestBody {
    if (typeof body !== 'function') {
        throw new TypeError('defineParameterizedTestBody() requires a body function.');
    }

    return defineParameterizedTestBodyFactory(body);
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

export function createTestFacade(definition: TestFacadeDefinition): TestFacade {
    const facadeDefinition = readTestFacadeDefinition(definition);

    return {
        defineMacro,
        defineParameterizedTestBody,
        runIfMain,
        suite(...input) {
            return createAuthoredSuite(facadeDefinition.testFamily, facadeDefinition.metadata, ...input);
        },
        table<Row>(tableDefinition: TableDefinition<Row>) {
            return createAuthoredTable(facadeDefinition.testFamily, facadeDefinition.metadata, tableDefinition);
        },
        test(...input) {
            return createAuthoredTest(facadeDefinition.testFamily, facadeDefinition.metadata, ...input);
        }
    };
}

export type {
    OutputRenderer,
    Reporter,
    Suite,
    Table,
    TestBody,
    TestCase,
    TestFamily,
    TestNode,
    TestScope,
    TestScopeAssertContext
} from '../engine/engine.entry-point.ts';
