const testFamilyValues = [ 'benchmark', 'integration', 'microtest', 'property', 'type-test' ] as const;
const capabilityValues = [
    'addon',
    'child-process',
    'fs-read',
    'fs-write',
    'net',
    'process-exit',
    'wasi',
    'worker'
] as const;
const baselineSubtypeValues = [
    'content-snapshot',
    'performance-baseline',
    'terminal-snapshot',
    'visual-snapshot'
] as const;
const stabilityValues = [ 'experimental', 'flaky', 'stable' ] as const;
const priorityValues = [ 'critical', 'optional', 'standard' ] as const;
const captureModeValues = [ 'buffered', 'live' ] as const;

export type TestFamily = typeof testFamilyValues[number];
export type Capability = typeof capabilityValues[number];
export type BaselineSubtype = typeof baselineSubtypeValues[number];
export type Stability = typeof stabilityValues[number];
export type Priority = typeof priorityValues[number];
export type CaptureMode = typeof captureModeValues[number];

export type RuntimeMetadata = {
    readonly mode: 'append' | 'replace';
    readonly values: readonly string[];
};

export type Metadata = {
    readonly baselines?: readonly BaselineSubtype[];
    readonly capabilities?: readonly Capability[];
    readonly capture?: CaptureMode;
    readonly debug?: boolean;
    readonly extra?: Readonly<Record<string, unknown>>;
    readonly kind?: TestFamily;
    readonly ownership?: readonly string[];
    readonly priority?: Priority;
    readonly runtimes?: RuntimeMetadata | readonly string[];
    readonly stability?: Stability;
    readonly tags?: readonly string[];
    readonly timeoutMilliseconds?: number;
};

export type ResolvedMetadata = {
    readonly baselines: readonly BaselineSubtype[];
    readonly capabilities: readonly Capability[];
    readonly capture: CaptureMode | null;
    readonly debug: boolean;
    readonly extra: Readonly<Record<string, unknown>>;
    readonly kind: TestFamily | null;
    readonly ownership: readonly string[];
    readonly priority: Priority;
    readonly runtimes: readonly string[];
    readonly stability: Stability;
    readonly tags: readonly string[];
    readonly timeoutMilliseconds: number | null;
};

const metadataFields: ReadonlySet<string> = new Set([
    'baselines',
    'capabilities',
    'capture',
    'debug',
    'extra',
    'kind',
    'ownership',
    'priority',
    'runtimes',
    'stability',
    'tags',
    'timeoutMilliseconds'
]);

const testFamilies: ReadonlySet<string> = new Set(testFamilyValues);
const capabilities: ReadonlySet<string> = new Set(capabilityValues);
const baselineSubtypes: ReadonlySet<string> = new Set(baselineSubtypeValues);
const stabilityNames: ReadonlySet<string> = new Set(stabilityValues);
const priorityNames: ReadonlySet<string> = new Set(priorityValues);
const captureModes: ReadonlySet<string> = new Set(captureModeValues);
const runtimeModes: ReadonlySet<string> = new Set([ 'append', 'replace' ]);

const defaultResolvedMetadata: ResolvedMetadata = {
    baselines: [],
    capabilities: [],
    capture: null,
    debug: false,
    extra: {},
    kind: null,
    ownership: [],
    priority: 'standard',
    runtimes: [],
    stability: 'stable',
    tags: [],
    timeoutMilliseconds: null
};

type StringField = 'ownership' | 'runtimes' | 'tags';
type EnumField = 'baselines' | 'capabilities';
type MetadataValidator = {
    readonly field: keyof Metadata;
    readonly validate: (value: unknown) => void;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertStringValue(value: unknown, field: string): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new TypeError(`Metadata field "${field}" must contain non-empty strings.`);
    }
}

function assertStringArray(value: unknown, field: StringField): asserts value is readonly string[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`Metadata field "${field}" must be an array.`);
    }

    for (const item of value) {
        assertStringValue(item, field);
    }
}

function assertEnumValue(value: unknown, field: string, allowed: ReadonlySet<string>): asserts value is string {
    if (typeof value !== 'string' || !allowed.has(value)) {
        throw new TypeError(`Metadata field "${field}" contains an unknown value.`);
    }
}

function assertEnumArray(value: unknown, field: EnumField, allowed: ReadonlySet<string>): void {
    if (!Array.isArray(value)) {
        throw new TypeError(`Metadata field "${field}" must be an array.`);
    }

    for (const item of value) {
        assertEnumValue(item, field, allowed);
    }
}

function assertRuntimeObjectFields(value: Readonly<Record<string, unknown>>): void {
    const extraFields = Object.keys(value).filter(function unknownRuntimeField(field) {
        return field !== 'mode' && field !== 'values';
    });

    if (extraFields.length > 0) {
        throw new TypeError(`Unknown runtime metadata field: ${extraFields[0]}.`);
    }
}

function assertRuntimeObject(value: unknown): void {
    if (!isRecord(value)) {
        throw new TypeError('Metadata field "runtimes" must be an array or runtime metadata object.');
    }

    assertRuntimeObjectFields(value);
    assertEnumValue(value.mode, 'runtimes.mode', runtimeModes);
    assertStringArray(value.values, 'runtimes');
}

function assertRuntimeMetadata(value: unknown): void {
    if (Array.isArray(value)) {
        assertStringArray(value, 'runtimes');
        return;
    }

    assertRuntimeObject(value);
}

function assertExtra(value: unknown): void {
    if (!isRecord(value)) {
        throw new TypeError('Metadata field "extra" must be an object.');
    }
}

function assertBoolean(value: unknown, field: string): asserts value is boolean {
    if (typeof value !== 'boolean') {
        throw new TypeError(`Metadata field "${field}" must be a boolean.`);
    }
}

function assertNumber(value: unknown, field: string): asserts value is number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`Metadata field "${field}" must be a finite number.`);
    }
}

function assertKnownMetadataFields(metadata: Readonly<Record<string, unknown>>): void {
    for (const field of Object.keys(metadata)) {
        if (!metadataFields.has(field)) {
            throw new TypeError(`Unknown metadata field: ${field}.`);
        }
    }
}

function validateTags(value: unknown): void {
    assertStringArray(value, 'tags');
}

function validateKind(value: unknown): void {
    assertEnumValue(value, 'kind', testFamilies);
}

function validateCapabilities(value: unknown): void {
    assertEnumArray(value, 'capabilities', capabilities);
}

function validateBaselines(value: unknown): void {
    assertEnumArray(value, 'baselines', baselineSubtypes);
}

function validateOwnership(value: unknown): void {
    assertStringArray(value, 'ownership');
}

function validateStability(value: unknown): void {
    assertEnumValue(value, 'stability', stabilityNames);
}

function validatePriority(value: unknown): void {
    assertEnumValue(value, 'priority', priorityNames);
}

function validateDebug(value: unknown): void {
    assertBoolean(value, 'debug');
}

function validateCapture(value: unknown): void {
    assertEnumValue(value, 'capture', captureModes);
}

function validateTimeoutMilliseconds(value: unknown): void {
    assertNumber(value, 'timeoutMilliseconds');
}

const metadataValidators: readonly MetadataValidator[] = [
    { field: 'tags', validate: validateTags },
    { field: 'kind', validate: validateKind },
    { field: 'runtimes', validate: assertRuntimeMetadata },
    { field: 'capabilities', validate: validateCapabilities },
    { field: 'baselines', validate: validateBaselines },
    { field: 'ownership', validate: validateOwnership },
    { field: 'stability', validate: validateStability },
    { field: 'priority', validate: validatePriority },
    { field: 'debug', validate: validateDebug },
    { field: 'capture', validate: validateCapture },
    { field: 'timeoutMilliseconds', validate: validateTimeoutMilliseconds },
    { field: 'extra', validate: assertExtra }
];

function validateMetadataFields(metadata: Readonly<Record<string, unknown>>): void {
    for (const validator of metadataValidators) {
        if (Object.hasOwn(metadata, validator.field)) {
            validator.validate(metadata[validator.field]);
        }
    }
}

export function ensureMetadata(value: unknown): asserts value is Metadata {
    if (!isRecord(value)) {
        throw new TypeError('Test node metadata must be an object.');
    }

    assertKnownMetadataFields(value);
    validateMetadataFields(value);
}

function mergeSetValues(parent: readonly string[], child: readonly string[]): readonly string[] {
    return Array.from(new Set([ ...parent, ...child ]));
}

function mergeEnumSetValues<Value extends string>(
    parent: readonly Value[],
    child: readonly Value[]
): readonly Value[] {
    return Array.from(new Set([ ...parent, ...child ]));
}

function isRuntimeMetadata(value: RuntimeMetadata | readonly string[]): value is RuntimeMetadata {
    return !Array.isArray(value);
}

function childRuntimes(parent: readonly string[], value: RuntimeMetadata | readonly string[]): readonly string[] {
    if (!isRuntimeMetadata(value)) {
        return mergeSetValues(parent, value);
    }

    if (value.mode === 'replace') {
        return mergeSetValues([], value.values);
    }

    return mergeSetValues(parent, value.values);
}

function assertCapabilitiesDoNotWiden(parent: readonly Capability[], child: readonly Capability[]): void {
    if (parent.length === 0) {
        return;
    }

    const parentCapabilities = new Set(parent);
    const widenedCapability = child.find(function missingParentCapability(capability) {
        return !parentCapabilities.has(capability);
    });

    if (widenedCapability !== undefined) {
        throw new TypeError(`Metadata capabilities cannot widen parent capability: ${widenedCapability}.`);
    }
}

type MetadataWithField<Field extends keyof Metadata> = Metadata & Required<Pick<Metadata, Field>>;

function hasMetadataField<Field extends keyof Metadata>(
    metadata: Metadata,
    field: Field
): metadata is MetadataWithField<Field> {
    return Object.hasOwn(metadata, field);
}

function resolvedBaselines(parent: ResolvedMetadata, child: Metadata): readonly BaselineSubtype[] {
    return hasMetadataField(child, 'baselines')
        ? mergeEnumSetValues(parent.baselines, child.baselines)
        : parent.baselines;
}

function resolvedCapabilities(parent: ResolvedMetadata, child: Metadata): readonly Capability[] {
    if (!hasMetadataField(child, 'capabilities')) {
        return parent.capabilities;
    }

    assertCapabilitiesDoNotWiden(parent.capabilities, child.capabilities);

    return child.capabilities;
}

function resolvedRuntimes(parent: ResolvedMetadata, child: Metadata): readonly string[] {
    if (!hasMetadataField(child, 'runtimes')) {
        return parent.runtimes;
    }

    return childRuntimes(parent.runtimes, child.runtimes);
}

function resolvedCapture(parent: ResolvedMetadata, child: Metadata): CaptureMode | null {
    if (!hasMetadataField(child, 'capture')) {
        return parent.capture;
    }

    return child.capture;
}

function resolvedDebug(parent: ResolvedMetadata, child: Metadata): boolean {
    if (!hasMetadataField(child, 'debug')) {
        return parent.debug;
    }

    return child.debug;
}

function resolvedExtra(parent: ResolvedMetadata, child: Metadata): Readonly<Record<string, unknown>> {
    if (!hasMetadataField(child, 'extra')) {
        return parent.extra;
    }

    return { ...parent.extra, ...child.extra };
}

function resolvedKind(parent: ResolvedMetadata, child: Metadata): TestFamily | null {
    if (!hasMetadataField(child, 'kind')) {
        return parent.kind;
    }

    return child.kind;
}

function resolvedOwnership(parent: ResolvedMetadata, child: Metadata): readonly string[] {
    if (!hasMetadataField(child, 'ownership')) {
        return parent.ownership;
    }

    return mergeSetValues(parent.ownership, child.ownership);
}

function resolvedPriority(parent: ResolvedMetadata, child: Metadata): Priority {
    if (!hasMetadataField(child, 'priority')) {
        return parent.priority;
    }

    return child.priority;
}

function resolvedStability(parent: ResolvedMetadata, child: Metadata): Stability {
    if (!hasMetadataField(child, 'stability')) {
        return parent.stability;
    }

    return child.stability;
}

function resolvedTags(parent: ResolvedMetadata, child: Metadata): readonly string[] {
    if (!hasMetadataField(child, 'tags')) {
        return parent.tags;
    }

    return mergeSetValues(parent.tags, child.tags);
}

function resolvedTimeoutMilliseconds(parent: ResolvedMetadata, child: Metadata): number | null {
    if (!hasMetadataField(child, 'timeoutMilliseconds')) {
        return parent.timeoutMilliseconds;
    }

    return child.timeoutMilliseconds;
}

export function resolveMetadata(parent: ResolvedMetadata, child: Metadata): ResolvedMetadata {
    ensureMetadata(child);

    return {
        baselines: resolvedBaselines(parent, child),
        capabilities: resolvedCapabilities(parent, child),
        capture: resolvedCapture(parent, child),
        debug: resolvedDebug(parent, child),
        extra: resolvedExtra(parent, child),
        kind: resolvedKind(parent, child),
        ownership: resolvedOwnership(parent, child),
        priority: resolvedPriority(parent, child),
        runtimes: resolvedRuntimes(parent, child),
        stability: resolvedStability(parent, child),
        tags: resolvedTags(parent, child),
        timeoutMilliseconds: resolvedTimeoutMilliseconds(parent, child)
    };
}

export function resolveRootMetadata(metadata: Metadata): ResolvedMetadata {
    return resolveMetadata(defaultResolvedMetadata, metadata);
}
