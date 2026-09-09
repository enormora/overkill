import {
    createSuite,
    createSkippedTestCase,
    createTestCase,
    type DefinedOutputRenderer,
    type DefinedReporter,
    type Metadata,
    ownsTestNode,
    type Suite,
    type Table,
    type TestBody,
    type TestCase,
    type TestFamily,
    type TestNode,
    type TestScope
} from '../engine/engine.entry-point.ts';
import {
    assertionBodyForActiveMacro,
    defineParameterizedTestBodyFactory,
    definitionLocationsForAuthoringCall,
    runMacroWithDefinitionLocations
} from './authoring-source-locations.ts';
import {
    createAuthoringMetadata,
    readAuthoringMetadata,
    readTestFacadeDefinition,
    type AuthoringMetadata,
    type AuthoringMetadataForFamily,
    type CaptureAuthoringMetadata,
    type TestFacadeDefinition,
    type TestFacadeDefinitionForFamily
} from './authoring-metadata.ts';
import {
    readAuthoringRecord,
    readAuthoringString,
    readAuthoringTestBody
} from './authoring-input.ts';
import { createAuthoredTable, type TableDefinition } from './table-authoring.ts';

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

type TestDefinition<MetadataType extends Metadata = AuthoringMetadata> = {
    readonly body: TestBody;
    readonly metadata: MetadataType;
    readonly title: string;
};

type RuntimeTestDefinition = {
    readonly body: TestBody;
    readonly metadata: Metadata;
    readonly title: string;
};

type SkippedTestDefinition<MetadataType extends Metadata = AuthoringMetadata> = {
    readonly metadata: MetadataType;
    readonly reason: string;
    readonly title: string;
};

type RuntimeSkippedTestDefinition = {
    readonly metadata: Metadata;
    readonly reason: string;
    readonly title: string;
};

type SuiteDefinition<MetadataType extends Metadata = AuthoringMetadata> = {
    readonly children: readonly TestNode[];
    readonly metadata: MetadataType;
    readonly title: string;
};

type RuntimeSuiteDefinition = {
    readonly children: readonly unknown[];
    readonly metadata: Metadata;
    readonly title: string;
};

type MacroFactory<MacroParameters extends readonly unknown[], Node extends TestNode> = (
    ...parameters: MacroParameters
) => Node;
type ParameterizedTestBody<Data> = (scope: TestScope, data: Data) => ReturnType<TestBody>;
type ObjectTestAuthorInput<MetadataType extends Metadata> = readonly [
    definition: Readonly<TestDefinition<MetadataType>>
];
type ObjectSkippedTestAuthorInput<MetadataType extends Metadata> = readonly [
    definition: Readonly<SkippedTestDefinition<MetadataType>>
];
type ObjectSuiteAuthorInput<MetadataType extends Metadata> = readonly [
    definition: Readonly<SuiteDefinition<MetadataType>>
];
type PositionalTestAuthorInput = readonly [title: string, body: TestBody];
type PositionalSkippedTestAuthorInput = readonly [title: string, reason: string];
type PositionalSuiteAuthorInput = readonly [title: string, children: readonly TestNode[]];
type TestAuthor<MetadataType extends Metadata> = (
    ...input: ObjectTestAuthorInput<MetadataType> | PositionalTestAuthorInput
) => TestCase;
type SkippedTestAuthor<MetadataType extends Metadata> = (
    ...input: ObjectSkippedTestAuthorInput<MetadataType> | PositionalSkippedTestAuthorInput
) => TestCase;
type SuiteAuthor<MetadataType extends Metadata> = (
    ...input: ObjectSuiteAuthorInput<MetadataType> | PositionalSuiteAuthorInput
) => Suite;
type TableAuthor<MetadataType extends Metadata> = <Row>(definition: TableDefinition<Row, MetadataType>) => Table;

export type TestFacade<MetadataType extends Metadata = AuthoringMetadata> = {
    readonly defineMacro: typeof defineMacro;
    readonly defineParameterizedTestBody: typeof defineParameterizedTestBody;
    readonly runIfMain: RunIfMain;
    readonly skippedTest: SkippedTestAuthor<MetadataType>;
    readonly suite: SuiteAuthor<MetadataType>;
    readonly table: TableAuthor<MetadataType>;
    readonly test: TestAuthor<MetadataType>;
};

const singleArgumentCount = 1;
const positionalArgumentCount = 2;
const testArgumentsError = 'test() requires (title, body) or ({ title, metadata, body }).';
const skippedTestArgumentsError = 'skippedTest() requires (title, reason) or ({ title, metadata, reason }).';
const suiteArgumentsError = 'suite() requires (title, children) or ({ title, metadata, children }).';

function readReason(value: unknown): string {
    if (typeof value !== 'string') {
        throw new TypeError(skippedTestArgumentsError);
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
    const definition = readAuthoringRecord(value, testArgumentsError);

    return {
        body: readAuthoringTestBody(definition.body),
        metadata: readAuthoringMetadata(definition.metadata),
        title: readAuthoringString(definition.title, testArgumentsError)
    };
}

function readSkippedTestDefinition(value: unknown): RuntimeSkippedTestDefinition {
    const definition = readAuthoringRecord(value, skippedTestArgumentsError);

    return {
        metadata: readAuthoringMetadata(definition.metadata),
        reason: readReason(definition.reason),
        title: readAuthoringString(definition.title, skippedTestArgumentsError)
    };
}

function readSuiteDefinition(value: unknown): RuntimeSuiteDefinition {
    const definition = readAuthoringRecord(value, suiteArgumentsError);

    return {
        children: readChildren(definition.children, suiteArgumentsError),
        metadata: readAuthoringMetadata(definition.metadata),
        title: readAuthoringString(definition.title, suiteArgumentsError)
    };
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
            body: assertionBodyForActiveMacro(readAuthoringTestBody(body)),
            definitionLocations: definitionLocationsForAuthoringCall(),
            metadata: createAuthoringMetadata(testFamily, facadeMetadata, {}),
            title: readAuthoringString(name, testArgumentsError)
        });
    }

    throw new TypeError(testArgumentsError);
}

export function test(...input: readonly [definition: Readonly<TestDefinition>]): TestCase;
export function test(...input: readonly [title: string, body: TestBody]): TestCase;
export function test(...input: readonly unknown[]): TestCase {
    return createAuthoredTest('microtest', {}, ...input);
}

function createAuthoredSkippedTest(
    testFamily: TestFamily,
    facadeMetadata: Metadata,
    ...input: readonly unknown[]
): TestCase {
    if (input.length === singleArgumentCount) {
        const definition = readSkippedTestDefinition(input[0]);

        return createSkippedTestCase({
            definitionLocations: definitionLocationsForAuthoringCall(),
            metadata: createAuthoringMetadata(testFamily, facadeMetadata, definition.metadata),
            reason: definition.reason,
            title: definition.title
        });
    }

    if (input.length === positionalArgumentCount) {
        const [ title, reason ] = input;

        return createSkippedTestCase({
            definitionLocations: definitionLocationsForAuthoringCall(),
            metadata: createAuthoringMetadata(testFamily, facadeMetadata, {}),
            reason: readReason(reason),
            title: readAuthoringString(title, skippedTestArgumentsError)
        });
    }

    throw new TypeError(skippedTestArgumentsError);
}

export function skippedTest(...input: readonly [definition: Readonly<SkippedTestDefinition>]): TestCase;
export function skippedTest(...input: readonly [title: string, reason: string]): TestCase;
export function skippedTest(...input: readonly unknown[]): TestCase {
    return createAuthoredSkippedTest('microtest', {}, ...input);
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
            title: readAuthoringString(name, suiteArgumentsError)
        });
    }

    throw new TypeError(suiteArgumentsError);
}

export function suite(...input: readonly [definition: Readonly<SuiteDefinition>]): Suite;
export function suite(...input: readonly [title: string, children: readonly TestNode[]]): Suite;
export function suite(...input: readonly unknown[]): Suite {
    return createAuthoredSuite('microtest', {}, ...input);
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

type ResolvedTestFacadeDefinition<Family extends TestFamily> = {
    readonly metadata: Metadata;
    readonly testFamily: Family;
};

function createTestFacadeFromDefinition<Family extends TestFamily>(
    facadeDefinition: ResolvedTestFacadeDefinition<Family>
): TestFacade<AuthoringMetadataForFamily<Family>> {
    return {
        defineMacro,
        defineParameterizedTestBody,
        runIfMain,
        skippedTest(...input) {
            return createAuthoredSkippedTest(facadeDefinition.testFamily, facadeDefinition.metadata, ...input);
        },
        suite(...input) {
            return createAuthoredSuite(facadeDefinition.testFamily, facadeDefinition.metadata, ...input);
        },
        table<Row>(tableDefinition: TableDefinition<Row, AuthoringMetadataForFamily<Family>>) {
            return createAuthoredTable(facadeDefinition.testFamily, facadeDefinition.metadata, tableDefinition);
        },
        test(...input) {
            return createAuthoredTest(facadeDefinition.testFamily, facadeDefinition.metadata, ...input);
        }
    };
}

export function createTestFacade<Family extends TestFamily>(
    definition: TestFacadeDefinitionForFamily<Family>
): TestFacade<AuthoringMetadataForFamily<Family>>;
export function createTestFacade(
    definition: TestFacadeDefinition
): TestFacade<AuthoringMetadata | CaptureAuthoringMetadata> {
    const facadeDefinition = readTestFacadeDefinition(definition);

    return createTestFacadeFromDefinition(facadeDefinition);
}
