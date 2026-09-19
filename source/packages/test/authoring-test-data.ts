import type {
    CaptureMode,
    DefinedOutputRenderer,
    DefinedReporter,
    DuplicateExecutionControl,
    TestAnnotationsInput,
    TestControlsInput,
    TestNode,
    TestScope
} from '../engine/engine.entry-point.ts';
import type {
    ResourceContext,
    ResourceMap,
    RuntimeGraph,
    RuntimeScopeContext
} from '../resources/resources.entry-point.ts';
import {
    ensureRuntimeGraph,
    readResourceMap
} from './resource-wrapper-data.ts';

export type AuthoringAnnotations = {
    readonly ownership?: readonly string[];
    readonly tags?: readonly string[];
};

export type AuthoringControls = {
    readonly capture?: CaptureMode;
    readonly duplicateExecution?: DuplicateExecutionControl;
    readonly timeoutMilliseconds?: number;
};

type EmptyResources = Readonly<Record<string, never>>;
type EmptyMappedScope = Readonly<Record<string, never>>;
type ReservedFacadeScopeKey = keyof TestScope | 'collect' | 'parameters' | 'resources' | 'runtimes';
type FacadeMappedScopeConflict<MappedScope extends Readonly<Record<string, unknown>>> = Extract<
    keyof MappedScope,
    ReservedFacadeScopeKey
>;
type ValidFacadeMappedScope<MappedScope extends Readonly<Record<string, unknown>>> =
    FacadeMappedScopeConflict<MappedScope> extends never ? MappedScope
        : MappedScope & Readonly<Record<FacadeMappedScopeConflict<MappedScope>, never>>;
type FacadeRuntimeScope<Runtime, Scope extends TestScope> = Runtime extends RuntimeGraph
    ? Scope & { readonly runtimes: RuntimeScopeContext<Runtime>; }
    : Scope;
type FacadeResourceMapScope<Resources extends ResourceMap, Scope extends TestScope> = keyof Resources extends never
    ? Scope
    : Scope & { readonly resources: ResourceContext<Resources>; };
type FacadeResourceScope<Resources, Scope extends TestScope> = Resources extends ResourceMap
    ? FacadeResourceMapScope<Resources, Scope>
    : Scope;
type FacadeMappedScope<
    MappedScope extends Readonly<Record<string, unknown>>,
    Scope extends TestScope
> = keyof MappedScope extends never ? Scope : MappedScope & Scope;
type FacadeBaseScope<
    Runtime extends RuntimeGraph | null,
    Resources extends ResourceMap
> = FacadeResourceScope<Resources, FacadeRuntimeScope<Runtime, TestScope>>;

export type FacadeScope<
    Runtime extends RuntimeGraph | null,
    Resources extends ResourceMap,
    MappedScope extends Readonly<Record<string, unknown>>
> = FacadeMappedScope<MappedScope, FacadeBaseScope<Runtime, Resources>>;

export type FacadeMapScope<
    Runtime extends RuntimeGraph | null,
    Resources extends ResourceMap,
    MappedScope extends Readonly<Record<string, unknown>>
> = (scope: FacadeBaseScope<Runtime, Resources>) => ValidFacadeMappedScope<MappedScope>;

export type TestFacadeDefinition<
    Runtime extends RuntimeGraph | null = null,
    Resources extends ResourceMap = EmptyResources,
    MappedScope extends Readonly<Record<string, unknown>> = EmptyMappedScope
> = {
    readonly annotations?: AuthoringAnnotations;
    readonly controls?: AuthoringControls;
    readonly mapScope?: FacadeMapScope<Runtime, Resources, MappedScope>;
    readonly resources?: Resources;
    readonly runtime?: Runtime;
};

export type ReadTestFacadeDefinitionResult = {
    readonly annotations: TestAnnotationsInput;
    readonly controls: TestControlsInput;
    readonly mapScope: ((scope: TestScope) => Readonly<Record<string, unknown>>) | null;
    readonly resources: ResourceMap | null;
    readonly runtime: RuntimeGraph | null;
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

const createTestFacadeArgumentsError =
    'createTestFacade() requires no arguments or ({ annotations?, controls?, runtime?, resources?, mapScope? }).';
const captureModeValues: readonly CaptureMode[] = [ 'buffered', 'live' ] as const;
const facadeDefinitionFields: ReadonlySet<string> = new Set([
    'annotations',
    'controls',
    'mapScope',
    'resources',
    'runtime'
]);
const knownCaptureModes: ReadonlySet<unknown> = new Set(captureModeValues);
const reservedFacadeScopeKeyValues: readonly ReservedFacadeScopeKey[] = [
    'assert',
    'cleanup',
    'collect',
    'drainMicrotasks',
    'parameters',
    'plan',
    'require',
    'resources',
    'runtimes',
    'settleAsyncWork',
    'signal',
    'startInFlight',
    'yieldToNextTurn'
];
const reservedFacadeScopeKeys: ReadonlySet<string> = new Set(reservedFacadeScopeKeyValues);

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

function readDuplicateExecution(value: unknown): DuplicateExecutionControl {
    if (value !== 'forbidden' && value !== 'idempotent') {
        throw new TypeError('Control field "duplicateExecution" contains an unknown value.');
    }

    return value;
}

function readTimeoutMilliseconds(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError('Control field "timeoutMilliseconds" must be a finite number.');
    }

    return value;
}

function readFacadeRuntime(value: unknown): RuntimeGraph {
    return ensureRuntimeGraph(value, 'createTestFacade() runtime must be a runtime descriptor.');
}

function readFacadeResources(value: unknown): ResourceMap {
    return readResourceMap(value, 'createTestFacade() resources must be a non-empty resource descriptor map.');
}

function isFacadeMapScope(value: unknown): value is (scope: TestScope) => Readonly<Record<string, unknown>> {
    return typeof value === 'function';
}

function readFacadeMappedScope(value: unknown): Readonly<Record<string, unknown>> {
    return readRecord(value, 'createTestFacade() mapScope must return an object.');
}

function readFacadeMapScope(value: unknown): (scope: TestScope) => Readonly<Record<string, unknown>> {
    if (!isFacadeMapScope(value)) {
        throw new TypeError('createTestFacade() mapScope must be a function.');
    }

    return function mapFacadeScope(scope) {
        const mappedScope = readFacadeMappedScope(value(scope));

        for (const key of Object.keys(mappedScope)) {
            if (reservedFacadeScopeKeys.has(key)) {
                throw new TypeError(`createTestFacade() mapScope must not return reserved scope key "${key}".`);
            }
        }

        return mappedScope;
    };
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
        ...Object.hasOwn(controls, 'duplicateExecution')
            ? { duplicateExecution: readDuplicateExecution(controls.duplicateExecution) }
            : {},
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

function mergedDuplicateExecution(
    facadeControls: TestControlsInput,
    nodeControls: TestControlsInput
): TestControlsInput['duplicateExecution'] | undefined {
    return dataField(nodeControls, 'duplicateExecution') ?? dataField(facadeControls, 'duplicateExecution');
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
    const duplicateExecution = mergedDuplicateExecution(facadeControls, nodeControls);
    const timeoutMilliseconds = mergedTimeoutMilliseconds(facadeControls, nodeControls);

    return {
        ...capture === undefined ? {} : { capture },
        ...duplicateExecution === undefined ? {} : { duplicateExecution },
        ...timeoutMilliseconds === undefined ? {} : { timeoutMilliseconds }
    };
}

function readFacadeAnnotations(definition: Readonly<Record<string, unknown>>): TestAnnotationsInput {
    return Object.hasOwn(definition, 'annotations')
        ? readAuthoringAnnotations(definition.annotations)
        : {};
}

function readFacadeControls(definition: Readonly<Record<string, unknown>>): TestControlsInput {
    return Object.hasOwn(definition, 'controls')
        ? readAuthoringControls(definition.controls)
        : {};
}

function readOptionalFacadeRuntime(definition: Readonly<Record<string, unknown>>): RuntimeGraph | null {
    return Object.hasOwn(definition, 'runtime')
        ? readFacadeRuntime(definition.runtime)
        : null;
}

function readOptionalFacadeResources(definition: Readonly<Record<string, unknown>>): ResourceMap | null {
    return Object.hasOwn(definition, 'resources')
        ? readFacadeResources(definition.resources)
        : null;
}

function readOptionalFacadeMapScope(
    definition: Readonly<Record<string, unknown>>
): ((scope: TestScope) => Readonly<Record<string, unknown>>) | null {
    return Object.hasOwn(definition, 'mapScope')
        ? readFacadeMapScope(definition.mapScope)
        : null;
}

export function readTestFacadeDefinition(
    definition: TestFacadeDefinition | undefined
): ReadTestFacadeDefinitionResult {
    if (definition === undefined) {
        return {
            annotations: {},
            controls: {},
            mapScope: null,
            resources: null,
            runtime: null
        };
    }

    const facadeDefinition = readRecord(definition, createTestFacadeArgumentsError);
    assertFacadeDefinitionFields(facadeDefinition);

    return {
        annotations: readFacadeAnnotations(facadeDefinition),
        controls: readFacadeControls(facadeDefinition),
        mapScope: readOptionalFacadeMapScope(facadeDefinition),
        resources: readOptionalFacadeResources(facadeDefinition),
        runtime: readOptionalFacadeRuntime(facadeDefinition)
    };
}
