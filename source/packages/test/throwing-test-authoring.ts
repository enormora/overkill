import {
    createThrowingTestCase,
    type TestAnnotationsInput,
    type TestCase,
    type TestControlsInput,
    type ThrowingTestBody
} from '../engine/engine.entry-point.ts';
import {
    createAuthoringAnnotations,
    createAuthoringControls,
    readAuthoringAnnotations,
    readAuthoringControls,
    type AuthoringAnnotations,
    type AuthoringControls
} from './authoring-test-data.ts';
import {
    readAuthoringRecord,
    readAuthoringString,
    readAuthoringThrowingTestBody
} from './authoring-input.ts';
import { definitionLocationsForAuthoringCall, throwingBodyForActiveMacro } from './authoring-source-locations.ts';

export type ThrowingTestDefinition = {
    readonly annotations?: AuthoringAnnotations;
    readonly body: ThrowingTestBody;
    readonly controls?: AuthoringControls;
    readonly title: string;
};

type RuntimeThrowingTestDefinition = {
    readonly annotations: TestAnnotationsInput;
    readonly body: ThrowingTestBody;
    readonly controls: TestControlsInput;
    readonly title: string;
};

export type ThrowingTestAuthor = {
    (definition: Readonly<ThrowingTestDefinition>): TestCase;
    (title: string, body: ThrowingTestBody): TestCase;
};

const singleArgumentCount = 1;
const positionalArgumentCount = 2;
const throwingTestArgumentsError =
    'throwingTest() requires (title, body) or ({ title, annotations?, controls?, body }).';

function readThrowingTestDefinition(value: unknown): RuntimeThrowingTestDefinition {
    const definition = readAuthoringRecord(value, throwingTestArgumentsError);

    return {
        annotations: readAuthoringAnnotations(definition.annotations ?? {}),
        body: readAuthoringThrowingTestBody(definition.body),
        controls: readAuthoringControls(definition.controls ?? {}),
        title: readAuthoringString(definition.title, throwingTestArgumentsError)
    };
}

function readPositionalThrowingTestDefinition(input: readonly unknown[]): RuntimeThrowingTestDefinition {
    const [ title, body ] = input;

    return {
        annotations: {},
        body: readAuthoringThrowingTestBody(body),
        controls: {},
        title: readAuthoringString(title, throwingTestArgumentsError)
    };
}

function createRuntimeThrowingTest(definition: RuntimeThrowingTestDefinition): TestCase {
    return createThrowingTestCase({
        annotations: createAuthoringAnnotations({}, definition.annotations),
        body: throwingBodyForActiveMacro(definition.body),
        controls: createAuthoringControls({}, definition.controls),
        definitionLocations: definitionLocationsForAuthoringCall(),
        title: definition.title
    });
}

function createAuthoredThrowingTest(...input: readonly unknown[]): TestCase {
    if (input.length === singleArgumentCount) {
        return createRuntimeThrowingTest(readThrowingTestDefinition(input[0]));
    }

    if (input.length === positionalArgumentCount) {
        return createRuntimeThrowingTest(readPositionalThrowingTestDefinition(input));
    }

    throw new TypeError(throwingTestArgumentsError);
}

export function throwingTest(...input: readonly [definition: Readonly<ThrowingTestDefinition>]): TestCase;
export function throwingTest(...input: readonly [title: string, body: ThrowingTestBody]): TestCase;
export function throwingTest(...input: readonly unknown[]): TestCase {
    return createAuthoredThrowingTest(...input);
}
