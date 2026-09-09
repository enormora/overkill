const captureModeValues = [ 'buffered', 'live' ] as const;

export type TestFamily = 'benchmark' | 'integration' | 'microtest' | 'property' | 'type-test';
export type CaptureMode = typeof captureModeValues[number];

export type TestAnnotationsInput = {
    readonly ownership?: readonly string[];
    readonly tags?: readonly string[];
};

export type TestAnnotations = {
    readonly ownership: readonly string[];
    readonly tags: readonly string[];
};

export type TestControlsInput = {
    readonly capture?: CaptureMode;
    readonly timeoutMilliseconds?: number;
};

export type TestControls = {
    readonly capture: CaptureMode | null;
    readonly timeoutMilliseconds: number | null;
};

const annotationFields: ReadonlySet<string> = new Set([ 'ownership', 'tags' ]);
const controlFields: ReadonlySet<string> = new Set([ 'capture', 'timeoutMilliseconds' ]);
const captureModes: ReadonlySet<string> = new Set(captureModeValues);

const defaultTestAnnotations: TestAnnotations = {
    ownership: [],
    tags: []
};

const defaultTestControls: TestControls = {
    capture: null,
    timeoutMilliseconds: null
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertStringValue(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`Annotation field "${field}" must contain non-empty strings.`);
    }
}

function assertStringArray(value: unknown, field: keyof TestAnnotations): asserts value is readonly string[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`Annotation field "${field}" must be an array.`);
    }

    for (const item of value) {
        assertStringValue(item, field);
    }
}

function assertCaptureMode(value: unknown): asserts value is CaptureMode {
    if (typeof value !== 'string' || !captureModes.has(value)) {
        throw new TypeError('Control field "capture" contains an unknown value.');
    }
}

function assertTimeoutMilliseconds(value: unknown): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError('Control field "timeoutMilliseconds" must be a finite number.');
    }
}

function assertKnownFields(
    value: Readonly<Record<string, unknown>>,
    fields: ReadonlySet<string>,
    messagePrefix: string
): void {
    for (const field of Object.keys(value)) {
        if (!fields.has(field)) {
            throw new TypeError(`${messagePrefix}: ${field}.`);
        }
    }
}

function ensureTestAnnotationsInput(value: unknown): asserts value is TestAnnotationsInput {
    if (!isRecord(value)) {
        throw new TypeError('Test node annotations must be an object.');
    }

    assertKnownFields(value, annotationFields, 'Unknown annotation field');

    if (Object.hasOwn(value, 'ownership')) {
        assertStringArray(value.ownership, 'ownership');
    }

    if (Object.hasOwn(value, 'tags')) {
        assertStringArray(value.tags, 'tags');
    }
}

function ensureTestControlsInput(value: unknown): asserts value is TestControlsInput {
    if (!isRecord(value)) {
        throw new TypeError('Test node controls must be an object.');
    }

    assertKnownFields(value, controlFields, 'Unknown control field');

    if (Object.hasOwn(value, 'capture')) {
        assertCaptureMode(value.capture);
    }

    if (Object.hasOwn(value, 'timeoutMilliseconds')) {
        assertTimeoutMilliseconds(value.timeoutMilliseconds);
    }
}

function mergeSetValues(parent: readonly string[], child: readonly string[]): readonly string[] {
    return Array.from(new Set([ ...parent, ...child ]));
}

function inputField<Field extends keyof TestAnnotationsInput>(
    input: TestAnnotationsInput,
    field: Field
): TestAnnotationsInput[Field] | undefined {
    return Object.hasOwn(input, field) ? input[field] : undefined;
}

function controlField<Field extends keyof TestControlsInput>(
    input: TestControlsInput,
    field: Field
): TestControlsInput[Field] | undefined {
    return Object.hasOwn(input, field) ? input[field] : undefined;
}

export function normalizeTestAnnotations(input: TestAnnotationsInput): TestAnnotations {
    ensureTestAnnotationsInput(input);

    return {
        ownership: inputField(input, 'ownership') ?? [],
        tags: inputField(input, 'tags') ?? []
    };
}

export function normalizeTestControls(input: TestControlsInput): TestControls {
    ensureTestControlsInput(input);

    return {
        capture: controlField(input, 'capture') ?? null,
        timeoutMilliseconds: controlField(input, 'timeoutMilliseconds') ?? null
    };
}

export function resolveTestAnnotations(
    parent: TestAnnotations,
    child: TestAnnotationsInput
): TestAnnotations {
    const annotations = normalizeTestAnnotations(child);

    return {
        ownership: mergeSetValues(parent.ownership, annotations.ownership),
        tags: mergeSetValues(parent.tags, annotations.tags)
    };
}

export function resolveRootTestAnnotations(annotations: TestAnnotationsInput): TestAnnotations {
    return resolveTestAnnotations(defaultTestAnnotations, annotations);
}

export function resolveTestControls(parent: TestControls, child: TestControlsInput): TestControls {
    const controls = normalizeTestControls(child);

    return {
        capture: controls.capture ?? parent.capture,
        timeoutMilliseconds: controls.timeoutMilliseconds ?? parent.timeoutMilliseconds
    };
}

export function resolveRootTestControls(controls: TestControlsInput): TestControls {
    return resolveTestControls(defaultTestControls, controls);
}
