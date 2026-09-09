import type {
    CaptureMode,
    DefinedOutputRenderer,
    DefinedReporter,
    TestAnnotationsInput,
    TestControlsInput,
    TestFamily,
    TestNode
} from '../engine/engine.entry-point.ts';

export type AuthoringAnnotations = {
    readonly ownership?: readonly string[];
    readonly tags?: readonly string[];
};

export type MicrotestAuthoringControls = {
    readonly capture?: never;
    readonly timeoutMilliseconds?: number;
};

export type CaptureAuthoringControls = {
    readonly capture?: CaptureMode;
    readonly timeoutMilliseconds?: number;
};

export type NonMicrotestFamily = Exclude<TestFamily, 'microtest'>;

export type AuthoringControlsForFamily<Family extends TestFamily> = Family extends 'microtest'
    ? MicrotestAuthoringControls
    : CaptureAuthoringControls;

type FacadeFamily<Family extends TestFamily> = {
    readonly testFamily: Family;
};

type FacadeTestData<Family extends TestFamily> = {
    readonly annotations: AuthoringAnnotations;
    readonly controls: AuthoringControlsForFamily<Family>;
    readonly testFamily: Family;
};

type FacadeAnnotations<Family extends TestFamily> = {
    readonly annotations: AuthoringAnnotations;
    readonly testFamily: Family;
};

type FacadeControls<Family extends TestFamily> = {
    readonly controls: AuthoringControlsForFamily<Family>;
    readonly testFamily: Family;
};

type FacadeDefinitionByKind<Family extends TestFamily> = {
    readonly annotations: FacadeAnnotations<Family>;
    readonly controls: FacadeControls<Family>;
    readonly family: FacadeFamily<Family>;
    readonly testData: FacadeTestData<Family>;
};

type FacadeDefinitionKind = 'annotations' | 'controls' | 'family' | 'testData';

type FacadeDefinitionParts<Family extends TestFamily> = FacadeDefinitionByKind<Family>[FacadeDefinitionKind];

export type MicrotestFacadeDefinition = FacadeDefinitionParts<'microtest'>;

export type CaptureFacadeDefinition = FacadeDefinitionParts<NonMicrotestFamily>;

export type TestFacadeDefinition = CaptureFacadeDefinition | MicrotestFacadeDefinition;

export type TestFacadeDefinitionForFamily<Family extends TestFamily> = FacadeDefinitionParts<Family>;

export type ReadTestFacadeDefinitionResult = {
    readonly annotations: TestAnnotationsInput;
    readonly controls: TestControlsInput;
    readonly testFamily: TestFamily;
};

export type RunIfMainRootOptions = {
    readonly annotations?: AuthoringAnnotations;
    readonly controls?: MicrotestAuthoringControls;
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

const createTestFacadeArgumentsError = 'createTestFacade() requires ({ testFamily, annotations?, controls? }).';
const testFamilyValues: readonly TestFamily[] = [
    'benchmark',
    'integration',
    'microtest',
    'property',
    'type-test'
] as const;
const captureModeValues: readonly CaptureMode[] = [ 'buffered', 'live' ] as const;
const knownTestFamilies: ReadonlySet<unknown> = new Set(testFamilyValues);
const knownCaptureModes: ReadonlySet<unknown> = new Set(captureModeValues);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, message: string): Readonly<Record<string, unknown>> {
    if (!isRecord(value)) {
        throw new TypeError(message);
    }

    return value;
}

function isTestFamily(value: unknown): value is TestFamily {
    return typeof value === 'string' && knownTestFamilies.has(value);
}

function isCaptureMode(value: unknown): value is CaptureMode {
    return typeof value === 'string' && knownCaptureModes.has(value);
}

function readTestFamily(value: unknown): TestFamily {
    if (!isTestFamily(value)) {
        throw new TypeError(createTestFacadeArgumentsError);
    }

    return value;
}

function readStringArray(value: unknown, field: string): readonly string[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`Annotation field "${field}" must be an array.`);
    }

    const items: string[] = [];

    for (const item of value) {
        if (typeof item !== 'string' || item.trim().length === 0) {
            throw new TypeError(`Annotation field "${field}" must contain non-empty strings.`);
        }

        items.push(item);
    }

    return items;
}

function readCapture(value: unknown): CaptureMode {
    if (!isCaptureMode(value)) {
        throw new TypeError('Control field "capture" contains an unknown value.');
    }

    return value;
}

function readTimeoutMilliseconds(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError('Control field "timeoutMilliseconds" must be a finite number.');
    }

    return value;
}

export function readAuthoringAnnotations(value: unknown): TestAnnotationsInput {
    const annotations = readRecord(value, 'Test node annotations must be an object.');

    return {
        ...Object.hasOwn(annotations, 'ownership')
            ? { ownership: readStringArray(annotations.ownership, 'ownership') }
            : {},
        ...Object.hasOwn(annotations, 'tags') ? { tags: readStringArray(annotations.tags, 'tags') } : {}
    };
}

export function readAuthoringControls(value: unknown): TestControlsInput {
    const controls = readRecord(value, 'Test node controls must be an object.');

    return {
        ...Object.hasOwn(controls, 'capture') ? { capture: readCapture(controls.capture) } : {},
        ...Object.hasOwn(controls, 'timeoutMilliseconds')
            ? { timeoutMilliseconds: readTimeoutMilliseconds(controls.timeoutMilliseconds) }
            : {}
    };
}

function dataField<Data extends TestAnnotationsInput | TestControlsInput, Field extends keyof Data>(
    data: Data,
    field: Field
): Data[Field] | undefined {
    return Object.hasOwn(data, field) ? data[field] : undefined;
}

function mergedStringSet<Field extends 'ownership' | 'tags'>(
    facadeAnnotations: TestAnnotationsInput,
    nodeAnnotations: TestAnnotationsInput,
    field: Field
): TestAnnotationsInput[Field] | undefined {
    const facadeValues = dataField(facadeAnnotations, field);
    const nodeValues = dataField(nodeAnnotations, field);

    if (facadeValues !== undefined && nodeValues !== undefined) {
        return Array.from(new Set([ ...facadeValues, ...nodeValues ]));
    }

    return nodeValues ?? facadeValues;
}

function mergedCapture(
    facadeControls: TestControlsInput,
    nodeControls: TestControlsInput
): TestControlsInput['capture'] | undefined {
    return dataField(nodeControls, 'capture') ?? dataField(facadeControls, 'capture');
}

function mergedTimeoutMilliseconds(
    facadeControls: TestControlsInput,
    nodeControls: TestControlsInput
): TestControlsInput['timeoutMilliseconds'] | undefined {
    return dataField(nodeControls, 'timeoutMilliseconds') ?? dataField(facadeControls, 'timeoutMilliseconds');
}

function assertMicrotestCapture(testFamily: TestFamily, controls: TestControlsInput): void {
    if (testFamily === 'microtest' && controls.capture !== undefined) {
        throw new TypeError('Microtest authoring controls do not support capture mode.');
    }
}

export function createAuthoringAnnotations(
    facadeAnnotations: TestAnnotationsInput,
    nodeAnnotations: TestAnnotationsInput
): TestAnnotationsInput {
    const ownership = mergedStringSet(facadeAnnotations, nodeAnnotations, 'ownership');
    const tags = mergedStringSet(facadeAnnotations, nodeAnnotations, 'tags');

    return {
        ...ownership === undefined ? {} : { ownership },
        ...tags === undefined ? {} : { tags }
    };
}

export function createAuthoringControls(
    testFamily: TestFamily,
    facadeControls: TestControlsInput,
    nodeControls: TestControlsInput
): TestControlsInput {
    const capture = mergedCapture(facadeControls, nodeControls);
    const timeoutMilliseconds = mergedTimeoutMilliseconds(facadeControls, nodeControls);
    const controls = {
        ...capture === undefined ? {} : { capture },
        ...timeoutMilliseconds === undefined ? {} : { timeoutMilliseconds }
    };

    assertMicrotestCapture(testFamily, controls);

    return controls;
}

export function readTestFacadeDefinition(definition: TestFacadeDefinition): ReadTestFacadeDefinitionResult {
    const facadeDefinition = readRecord(definition, createTestFacadeArgumentsError);
    const testFamily = readTestFamily(facadeDefinition.testFamily);
    const annotations = Object.hasOwn(facadeDefinition, 'annotations')
        ? readAuthoringAnnotations(facadeDefinition.annotations)
        : {};
    const controls = Object.hasOwn(facadeDefinition, 'controls')
        ? readAuthoringControls(facadeDefinition.controls)
        : {};
    assertMicrotestCapture(testFamily, controls);

    return {
        annotations,
        controls,
        testFamily
    };
}
