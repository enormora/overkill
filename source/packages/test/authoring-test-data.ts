import type {
    CaptureMode,
    DefinedOutputRenderer,
    DefinedReporter,
    TestAnnotationsInput,
    TestControlsInput,
    TestNode
} from '../engine/engine.entry-point.ts';

export type AuthoringAnnotations = {
    readonly ownership?: readonly string[];
    readonly tags?: readonly string[];
};

export type AuthoringControls = {
    readonly capture?: CaptureMode;
    readonly timeoutMilliseconds?: number;
};

export type TestFacadeDefinition = {
    readonly annotations?: AuthoringAnnotations;
    readonly controls?: AuthoringControls;
};

export type ReadTestFacadeDefinitionResult = {
    readonly annotations: TestAnnotationsInput;
    readonly controls: TestControlsInput;
};

export type RunIfMainRootOptions = {
    readonly annotations?: AuthoringAnnotations;
    readonly controls?: AuthoringControls;
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

const createTestFacadeArgumentsError = 'createTestFacade() requires no arguments or ({ annotations?, controls? }).';
const captureModeValues: readonly CaptureMode[] = [ 'buffered', 'live' ] as const;
const facadeDefinitionFields: ReadonlySet<string> = new Set([ 'annotations', 'controls', 'testFamily' ]);
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

function assertFacadeDefinitionFields(definition: Readonly<Record<string, unknown>>): void {
    for (const field of Object.keys(definition)) {
        if (!facadeDefinitionFields.has(field)) {
            throw new TypeError(createTestFacadeArgumentsError);
        }
    }
}

function isCaptureMode(value: unknown): value is CaptureMode {
    return typeof value === 'string' && knownCaptureModes.has(value);
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
    facadeControls: TestControlsInput,
    nodeControls: TestControlsInput
): TestControlsInput {
    const capture = mergedCapture(facadeControls, nodeControls);
    const timeoutMilliseconds = mergedTimeoutMilliseconds(facadeControls, nodeControls);

    return {
        ...capture === undefined ? {} : { capture },
        ...timeoutMilliseconds === undefined ? {} : { timeoutMilliseconds }
    };
}

export function readTestFacadeDefinition(
    definition: TestFacadeDefinition | undefined
): ReadTestFacadeDefinitionResult {
    if (definition === undefined) {
        return {
            annotations: {},
            controls: {}
        };
    }

    const facadeDefinition = readRecord(definition, createTestFacadeArgumentsError);
    assertFacadeDefinitionFields(facadeDefinition);
    const annotations = Object.hasOwn(facadeDefinition, 'annotations')
        ? readAuthoringAnnotations(facadeDefinition.annotations)
        : {};
    const controls = Object.hasOwn(facadeDefinition, 'controls')
        ? readAuthoringControls(facadeDefinition.controls)
        : {};

    return {
        annotations,
        controls
    };
}
