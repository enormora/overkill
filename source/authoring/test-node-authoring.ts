import {
    createSuite,
    createSkippedTestCase,
    createTestCase,
    ownsTestNode,
    type Suite,
    type Table,
    type TestAnnotationsInput,
    type TestBody,
    type TestCase,
    type TestControlsInput,
    type TestNode,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import {
    assertionBodyForActiveMacro,
    defineParameterizedTestBodyFactory,
    definitionLocationsForAuthoringCall,
    runMacroWithDefinitionLocations
} from '../packages/test/authoring-source-locations.ts';
import {
    createAuthoringAnnotations,
    createAuthoringControls,
    readAuthoringAnnotations,
    readAuthoringControls,
    type AuthoringAnnotations,
    type AuthoringControls
} from '../packages/test/authoring-test-data.ts';
import {
    readAuthoringRecord,
    readAuthoringString,
    readAuthoringTestBody
} from '../packages/test/authoring-input.ts';
import {
    createAuthoredTable,
    type ParameterizedTestScope,
    type TableDefinition
} from '../packages/test/table-authoring.ts';
import { attachComposedResourceActions } from '../packages/test/resource-wrapper-composition.ts';
import type {
    ResourceWrapperAction
} from '../packages/test/resource-wrapper-data.ts';

type TestDefinition<
    ControlsType extends TestControlsInput = AuthoringControls,
    Scope extends TestScope = TestScope
> = {
    readonly annotations?: AuthoringAnnotations;
    readonly body: (scope: Scope) => ReturnType<TestBody>;
    readonly controls?: ControlsType;
    readonly title: string;
};

type RuntimeTestDefinition = {
    readonly annotations: TestAnnotationsInput;
    readonly body: TestBody;
    readonly controls: TestControlsInput;
    readonly title: string;
};

type SkippedTestDefinition<ControlsType extends TestControlsInput = AuthoringControls> = {
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

type SuiteDefinition<ControlsType extends TestControlsInput = AuthoringControls> = {
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
type ObjectSkippedTestAuthorInput<ControlsType extends TestControlsInput> = readonly [
    definition: Readonly<SkippedTestDefinition<ControlsType>>
];
type ObjectSuiteAuthorInput<ControlsType extends TestControlsInput> = readonly [
    definition: Readonly<SuiteDefinition<ControlsType>>
];
type PositionalSkippedTestAuthorInput = readonly [title: string, reason: string];
type PositionalSuiteAuthorInput = readonly [title: string, children: readonly TestNode[]];
type ObjectScopedTestAuthorInput<
    ControlsType extends TestControlsInput,
    Scope extends TestScope
> = readonly [
    definition: Readonly<TestDefinition<ControlsType, Scope>>
];
type PositionalTestAuthorInput<Scope extends TestScope> = readonly [
    title: string,
    body: (scope: Scope) => ReturnType<TestBody>
];
type DefaultTestAuthor = {
    (...input: ObjectScopedTestAuthorInput<AuthoringControls, TestScope>): TestCase;
    (...input: PositionalTestAuthorInput<TestScope>): TestCase;
};
type DefaultSkippedTestAuthor = {
    (...input: ObjectSkippedTestAuthorInput<AuthoringControls>): TestCase;
    (...input: PositionalSkippedTestAuthorInput): TestCase;
};
type DefaultSuiteAuthor = {
    (...input: ObjectSuiteAuthorInput<AuthoringControls>): Suite;
    (...input: PositionalSuiteAuthorInput): Suite;
};

export type TestAuthor<
    ControlsType extends TestControlsInput,
    Scope extends TestScope
> = (
    ...input: ObjectScopedTestAuthorInput<ControlsType, Scope> | PositionalTestAuthorInput<Scope>
) => TestCase;
export type SkippedTestAuthor<ControlsType extends TestControlsInput> = (
    ...input: ObjectSkippedTestAuthorInput<ControlsType> | PositionalSkippedTestAuthorInput
) => TestCase;
export type SuiteAuthor<ControlsType extends TestControlsInput> = (
    ...input: ObjectSuiteAuthorInput<ControlsType> | PositionalSuiteAuthorInput
) => Suite;
export type TableAuthor<
    ControlsType extends TestControlsInput,
    Scope extends TestScope
> = <Row>(
    definition: TableDefinition<Row, ControlsType, (scope: ParameterizedTestScope<Row, Scope>) => ReturnType<TestBody>>
) => Table;

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

function composeFacadeBody(
    facadeActions: readonly ResourceWrapperAction[],
    body: TestBody
): TestBody {
    return facadeActions.length === 0
        ? body
        : attachComposedResourceActions(facadeActions, body, 'createTestFacade');
}

export function createAuthoredTest(
    facadeAnnotations: TestAnnotationsInput,
    facadeControls: TestControlsInput,
    facadeActions: readonly ResourceWrapperAction[],
    ...input: readonly unknown[]
): TestCase {
    if (input.length === singleArgumentCount) {
        const definition = readTestDefinition(input[0]);

        return createTestCase({
            annotations: createAuthoringAnnotations(facadeAnnotations, definition.annotations),
            body: assertionBodyForActiveMacro(composeFacadeBody(facadeActions, definition.body)),
            controls: createAuthoringControls(facadeControls, definition.controls),
            definitionLocations: definitionLocationsForAuthoringCall(),
            title: definition.title
        });
    }

    if (input.length === positionalArgumentCount) {
        const [ name, body ] = input;
        const testBody = readAuthoringTestBody(body);

        return createTestCase({
            annotations: createAuthoringAnnotations(facadeAnnotations, {}),
            body: assertionBodyForActiveMacro(composeFacadeBody(facadeActions, testBody)),
            controls: createAuthoringControls(facadeControls, {}),
            definitionLocations: definitionLocationsForAuthoringCall(),
            title: readAuthoringString(name, testArgumentsError)
        });
    }

    throw new TypeError(testArgumentsError);
}

export const test: DefaultTestAuthor = function (...input: readonly unknown[]): TestCase {
    return createAuthoredTest({}, {}, [], ...input);
};

export function createAuthoredSkippedTest(
    facadeAnnotations: TestAnnotationsInput,
    facadeControls: TestControlsInput,
    ...input: readonly unknown[]
): TestCase {
    if (input.length === singleArgumentCount) {
        const definition = readSkippedTestDefinition(input[0]);

        return createSkippedTestCase({
            annotations: createAuthoringAnnotations(facadeAnnotations, definition.annotations),
            controls: createAuthoringControls(facadeControls, definition.controls),
            definitionLocations: definitionLocationsForAuthoringCall(),
            reason: definition.reason,
            title: definition.title
        });
    }

    if (input.length === positionalArgumentCount) {
        const [ title, reason ] = input;

        return createSkippedTestCase({
            annotations: createAuthoringAnnotations(facadeAnnotations, {}),
            controls: createAuthoringControls(facadeControls, {}),
            definitionLocations: definitionLocationsForAuthoringCall(),
            reason: readReason(reason),
            title: readAuthoringString(title, skippedTestArgumentsError)
        });
    }

    throw new TypeError(skippedTestArgumentsError);
}

export const skippedTest: DefaultSkippedTestAuthor = function (...input: readonly unknown[]): TestCase {
    return createAuthoredSkippedTest({}, {}, ...input);
};

export function createAuthoredSuite(
    facadeAnnotations: TestAnnotationsInput,
    facadeControls: TestControlsInput,
    ...input: readonly unknown[]
): Suite {
    if (input.length === singleArgumentCount) {
        const definition = readSuiteDefinition(input[0]);

        return createSuite({
            annotations: createAuthoringAnnotations(facadeAnnotations, definition.annotations),
            children: definition.children,
            controls: createAuthoringControls(facadeControls, definition.controls),
            definitionLocations: definitionLocationsForAuthoringCall(),
            title: definition.title
        });
    }

    if (input.length === positionalArgumentCount) {
        const [ name, children ] = input;

        return createSuite({
            annotations: createAuthoringAnnotations(facadeAnnotations, {}),
            children: readChildren(children, suiteArgumentsError),
            controls: createAuthoringControls(facadeControls, {}),
            definitionLocations: definitionLocationsForAuthoringCall(),
            title: readAuthoringString(name, suiteArgumentsError)
        });
    }

    throw new TypeError(suiteArgumentsError);
}

export const suite: DefaultSuiteAuthor = function (...input: readonly unknown[]): Suite {
    return createAuthoredSuite({}, {}, ...input);
};

export function table<Row>(definition: TableDefinition<Row>): Table {
    return createAuthoredTable({}, {}, definition, []);
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
