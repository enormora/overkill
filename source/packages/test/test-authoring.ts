import {
    createSuite,
    createSkippedTestCase,
    createTestCase,
    ownsTestNode,
    stampTestNodeFamily,
    type Suite,
    type Table,
    type TestAnnotationsInput,
    type TestBody,
    type TestCase,
    type TestControlsInput,
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
    createAuthoringAnnotations,
    createAuthoringControls,
    readAuthoringAnnotations,
    readAuthoringControls,
    readTestFacadeDefinition,
    type AuthoringAnnotations,
    type AuthoringControlsForFamily,
    type CaptureAuthoringControls,
    type MicrotestAuthoringControls,
    type RunIfMain,
    type RunIfMainOptions,
    type TestFacadeDefinition,
    type TestFacadeDefinitionForFamily
} from './authoring-test-data.ts';
import {
    readAuthoringRecord,
    readAuthoringString,
    readAuthoringTestBody
} from './authoring-input.ts';
import { createAuthoredTable, type TableDefinition } from './table-authoring.ts';

type TestDefinition<ControlsType extends TestControlsInput = MicrotestAuthoringControls> = {
    readonly annotations?: AuthoringAnnotations;
    readonly body: TestBody;
    readonly controls?: ControlsType;
    readonly title: string;
};

type RuntimeTestDefinition = {
    readonly annotations: TestAnnotationsInput;
    readonly body: TestBody;
    readonly controls: TestControlsInput;
    readonly title: string;
};

type SkippedTestDefinition<ControlsType extends TestControlsInput = MicrotestAuthoringControls> = {
    readonly annotations?: AuthoringAnnotations;
    readonly controls?: ControlsType;
    readonly reason: string;
    readonly title: string;
};

type RuntimeSkippedTestDefinition = {
    readonly annotations: TestAnnotationsInput;
    readonly controls: TestControlsInput;
    readonly reason: string;
    readonly title: string;
};

type SuiteDefinition<ControlsType extends TestControlsInput = MicrotestAuthoringControls> = {
    readonly annotations?: AuthoringAnnotations;
    readonly children: readonly TestNode[];
    readonly controls?: ControlsType;
    readonly title: string;
};

type RuntimeSuiteDefinition = {
    readonly annotations: TestAnnotationsInput;
    readonly children: readonly unknown[];
    readonly controls: TestControlsInput;
    readonly title: string;
};

type MacroFactory<MacroParameters extends readonly unknown[], Node extends TestNode> = (
    ...parameters: MacroParameters
) => Node;
type ParameterizedTestBody<Data> = (scope: TestScope, data: Data) => ReturnType<TestBody>;
type ObjectTestAuthorInput<ControlsType extends TestControlsInput> = readonly [
    definition: Readonly<TestDefinition<ControlsType>>
];
type ObjectSkippedTestAuthorInput<ControlsType extends TestControlsInput> = readonly [
    definition: Readonly<SkippedTestDefinition<ControlsType>>
];
type ObjectSuiteAuthorInput<ControlsType extends TestControlsInput> = readonly [
    definition: Readonly<SuiteDefinition<ControlsType>>
];
type PositionalTestAuthorInput = readonly [title: string, body: TestBody];
type PositionalSkippedTestAuthorInput = readonly [title: string, reason: string];
type PositionalSuiteAuthorInput = readonly [title: string, children: readonly TestNode[]];
type TestAuthor<ControlsType extends TestControlsInput> = (
    ...input: ObjectTestAuthorInput<ControlsType> | PositionalTestAuthorInput
) => TestCase;
type SkippedTestAuthor<ControlsType extends TestControlsInput> = (
    ...input: ObjectSkippedTestAuthorInput<ControlsType> | PositionalSkippedTestAuthorInput
) => TestCase;
type SuiteAuthor<ControlsType extends TestControlsInput> = (
    ...input: ObjectSuiteAuthorInput<ControlsType> | PositionalSuiteAuthorInput
) => Suite;
type TableAuthor<ControlsType extends TestControlsInput> = <Row>(
    definition: TableDefinition<Row, ControlsType>
) => Table;

export type TestFacade<ControlsType extends TestControlsInput = MicrotestAuthoringControls> = {
    readonly defineMacro: typeof defineMacro;
    readonly defineParameterizedTestBody: typeof defineParameterizedTestBody;
    readonly runIfMain: RunIfMain;
    readonly skippedTest: SkippedTestAuthor<ControlsType>;
    readonly suite: SuiteAuthor<ControlsType>;
    readonly table: TableAuthor<ControlsType>;
    readonly test: TestAuthor<ControlsType>;
};

const singleArgumentCount = 1;
const positionalArgumentCount = 2;
const testArgumentsError = 'test() requires (title, body) or ({ title, annotations?, controls?, body }).';
const skippedTestArgumentsError =
    'skippedTest() requires (title, reason) or ({ title, annotations?, controls?, reason }).';
const suiteArgumentsError = 'suite() requires (title, children) or ({ title, annotations?, controls?, children }).';

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
        annotations: readAuthoringAnnotations(definition.annotations ?? {}),
        body: readAuthoringTestBody(definition.body),
        controls: readAuthoringControls(definition.controls ?? {}),
        title: readAuthoringString(definition.title, testArgumentsError)
    };
}

function readSkippedTestDefinition(value: unknown): RuntimeSkippedTestDefinition {
    const definition = readAuthoringRecord(value, skippedTestArgumentsError);

    return {
        annotations: readAuthoringAnnotations(definition.annotations ?? {}),
        controls: readAuthoringControls(definition.controls ?? {}),
        reason: readReason(definition.reason),
        title: readAuthoringString(definition.title, skippedTestArgumentsError)
    };
}

function readSuiteDefinition(value: unknown): RuntimeSuiteDefinition {
    const definition = readAuthoringRecord(value, suiteArgumentsError);

    return {
        annotations: readAuthoringAnnotations(definition.annotations ?? {}),
        children: readChildren(definition.children, suiteArgumentsError),
        controls: readAuthoringControls(definition.controls ?? {}),
        title: readAuthoringString(definition.title, suiteArgumentsError)
    };
}

function stampedNode<Node extends TestNode>(node: Node, testFamily: TestFamily): Node {
    stampTestNodeFamily(node, testFamily);

    return node;
}

function createAuthoredTest(
    testFamily: TestFamily,
    facadeAnnotations: TestAnnotationsInput,
    facadeControls: TestControlsInput,
    ...input: readonly unknown[]
): TestCase {
    if (input.length === singleArgumentCount) {
        const definition = readTestDefinition(input[0]);

        return stampedNode(
            createTestCase({
                annotations: createAuthoringAnnotations(facadeAnnotations, definition.annotations),
                body: assertionBodyForActiveMacro(definition.body),
                controls: createAuthoringControls(testFamily, facadeControls, definition.controls),
                definitionLocations: definitionLocationsForAuthoringCall(),
                title: definition.title
            }),
            testFamily
        );
    }

    if (input.length === positionalArgumentCount) {
        const [ name, body ] = input;

        return stampedNode(
            createTestCase({
                annotations: createAuthoringAnnotations(facadeAnnotations, {}),
                body: assertionBodyForActiveMacro(readAuthoringTestBody(body)),
                controls: createAuthoringControls(testFamily, facadeControls, {}),
                definitionLocations: definitionLocationsForAuthoringCall(),
                title: readAuthoringString(name, testArgumentsError)
            }),
            testFamily
        );
    }

    throw new TypeError(testArgumentsError);
}

export function test(...input: readonly [definition: Readonly<TestDefinition>]): TestCase;
export function test(...input: readonly [title: string, body: TestBody]): TestCase;
export function test(...input: readonly unknown[]): TestCase {
    return createAuthoredTest('microtest', {}, {}, ...input);
}

function createAuthoredSkippedTest(
    testFamily: TestFamily,
    facadeAnnotations: TestAnnotationsInput,
    facadeControls: TestControlsInput,
    ...input: readonly unknown[]
): TestCase {
    if (input.length === singleArgumentCount) {
        const definition = readSkippedTestDefinition(input[0]);

        return stampedNode(
            createSkippedTestCase({
                annotations: createAuthoringAnnotations(facadeAnnotations, definition.annotations),
                controls: createAuthoringControls(testFamily, facadeControls, definition.controls),
                definitionLocations: definitionLocationsForAuthoringCall(),
                reason: definition.reason,
                title: definition.title
            }),
            testFamily
        );
    }

    if (input.length === positionalArgumentCount) {
        const [ title, reason ] = input;

        return stampedNode(
            createSkippedTestCase({
                annotations: createAuthoringAnnotations(facadeAnnotations, {}),
                controls: createAuthoringControls(testFamily, facadeControls, {}),
                definitionLocations: definitionLocationsForAuthoringCall(),
                reason: readReason(reason),
                title: readAuthoringString(title, skippedTestArgumentsError)
            }),
            testFamily
        );
    }

    throw new TypeError(skippedTestArgumentsError);
}

export function skippedTest(...input: readonly [definition: Readonly<SkippedTestDefinition>]): TestCase;
export function skippedTest(...input: readonly [title: string, reason: string]): TestCase;
export function skippedTest(...input: readonly unknown[]): TestCase {
    return createAuthoredSkippedTest('microtest', {}, {}, ...input);
}

function createAuthoredSuite(
    testFamily: TestFamily,
    facadeAnnotations: TestAnnotationsInput,
    facadeControls: TestControlsInput,
    ...input: readonly unknown[]
): Suite {
    if (input.length === singleArgumentCount) {
        const definition = readSuiteDefinition(input[0]);

        return stampedNode(
            createSuite({
                annotations: createAuthoringAnnotations(facadeAnnotations, definition.annotations),
                children: definition.children,
                controls: createAuthoringControls(testFamily, facadeControls, definition.controls),
                definitionLocations: definitionLocationsForAuthoringCall(),
                title: definition.title
            }),
            testFamily
        );
    }

    if (input.length === positionalArgumentCount) {
        const [ name, children ] = input;

        return stampedNode(
            createSuite({
                annotations: createAuthoringAnnotations(facadeAnnotations, {}),
                children: readChildren(children, suiteArgumentsError),
                controls: createAuthoringControls(testFamily, facadeControls, {}),
                definitionLocations: definitionLocationsForAuthoringCall(),
                title: readAuthoringString(name, suiteArgumentsError)
            }),
            testFamily
        );
    }

    throw new TypeError(suiteArgumentsError);
}

export function suite(...input: readonly [definition: Readonly<SuiteDefinition>]): Suite;
export function suite(...input: readonly [title: string, children: readonly TestNode[]]): Suite;
export function suite(...input: readonly unknown[]): Suite {
    return createAuthoredSuite('microtest', {}, {}, ...input);
}

export function table<Row>(definition: TableDefinition<Row>): Table {
    return createAuthoredTable('microtest', {}, {}, definition);
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
    readonly annotations: TestAnnotationsInput;
    readonly controls: TestControlsInput;
    readonly testFamily: Family;
};

function createTestFacadeFromDefinition<Family extends TestFamily>(
    facadeDefinition: ResolvedTestFacadeDefinition<Family>
): TestFacade<AuthoringControlsForFamily<Family>> {
    return {
        defineMacro,
        defineParameterizedTestBody,
        runIfMain,
        skippedTest(...input) {
            return createAuthoredSkippedTest(
                facadeDefinition.testFamily,
                facadeDefinition.annotations,
                facadeDefinition.controls,
                ...input
            );
        },
        suite(...input) {
            return createAuthoredSuite(
                facadeDefinition.testFamily,
                facadeDefinition.annotations,
                facadeDefinition.controls,
                ...input
            );
        },
        table<Row>(tableDefinition: TableDefinition<Row, AuthoringControlsForFamily<Family>>) {
            return createAuthoredTable(
                facadeDefinition.testFamily,
                facadeDefinition.annotations,
                facadeDefinition.controls,
                tableDefinition
            );
        },
        test(...input) {
            return createAuthoredTest(
                facadeDefinition.testFamily,
                facadeDefinition.annotations,
                facadeDefinition.controls,
                ...input
            );
        }
    };
}

export function createTestFacade<Family extends TestFamily>(
    definition: TestFacadeDefinitionForFamily<Family>
): TestFacade<AuthoringControlsForFamily<Family>>;
export function createTestFacade(
    definition: TestFacadeDefinition
): TestFacade<CaptureAuthoringControls | MicrotestAuthoringControls> {
    const facadeDefinition = readTestFacadeDefinition(definition);

    return createTestFacadeFromDefinition(facadeDefinition);
}
