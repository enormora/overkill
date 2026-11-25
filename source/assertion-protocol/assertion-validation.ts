import { types } from 'node:util';
import { resolveSourceLocation, unknownSourceLocation } from './source-location.ts';
import type {
    AssertionNode,
    CompositeAssertionChildNode
} from './assertion-node.ts';
import type {
    AssertionSource,
    NonEmptyReadonlyArray,
    ResolvableSourceLocation,
    ResolvableSourceLocations,
    SourceLocation
} from './assertion-node-shape.ts';
import type { AssertionNodeByCheck } from './assertions/dispatch.ts';

export type ProtocolRecord = Readonly<Record<string, unknown>>;

type FieldRule = (value: unknown) => boolean;

function operand(): boolean {
    return true;
}

function propertyKey(value: unknown): boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'symbol';
}

function number(value: unknown): boolean {
    return typeof value === 'number';
}

function constructible(value: unknown): boolean {
    if (typeof value !== 'function') {
        return false;
    }
    try {
        Reflect.construct(
            new Proxy(value, {
                construct() {
                    return {};
                }
            }),
            []
        );
        return true;
    } catch {
        return false;
    }
}

const actualFields = { actual: operand };
const comparisonFields = { ...actualFields, expected: operand };
const patternFields = { ...actualFields, pattern: types.isRegExp };

type FieldsByCheck = {
    [Check in keyof AssertionNodeByCheck]: Readonly<
        Record<
            Exclude<keyof AssertionNodeByCheck[Check], 'check' | 'message' | 'source' | 'sourceLocations'>,
            FieldRule
        >
    >;
};

const fieldsByCheck: FieldsByCheck = {
    array: actualFields,
    'array-contains-partial': comparisonFields,
    between: { ...actualFields, minimum: number, maximum: number },
    boolean: actualFields,
    'deep-equal': comparisonFields,
    defined: actualFields,
    empty: actualFields,
    'ends-with': comparisonFields,
    equal: comparisonFields,
    fail: {},
    false: actualFields,
    function: actualFields,
    'greater-than': comparisonFields,
    'greater-than-or-equal': comparisonFields,
    'has-property': { ...actualFields, key: propertyKey },
    includes: comparisonFields,
    'instance-of': { ...actualFields, expected: constructible },
    length: { ...actualFields, expectedLength: number },
    'less-than': comparisonFields,
    'less-than-or-equal': comparisonFields,
    match: patternFields,
    'members-partial-deep-equal': comparisonFields,
    'not-deep-equal': comparisonFields,
    'not-empty': actualFields,
    'not-equal': comparisonFields,
    'not-match': patternFields,
    'not-null': actualFields,
    null: actualFields,
    number: actualFields,
    object: actualFields,
    'partial-deep-equal': comparisonFields,
    'starts-with': comparisonFields,
    string: actualFields,
    true: actualFields,
    undefined: actualFields
};

const requireChecks: ReadonlySet<string> = new Set([
    'array',
    'boolean',
    'defined',
    'function',
    'has-property',
    'instance-of',
    'not-null',
    'null',
    'number',
    'object',
    'string'
]);

type AssertionProtocolDiagnostic = {
    readonly path: string;
    readonly reason: string;
};

export class InvalidAssertionProtocolError extends Error {
    private readonly details: AssertionProtocolDiagnostic;

    public constructor(details: AssertionProtocolDiagnostic, options: ErrorOptions) {
        super(`Invalid assertion protocol at ${details.path}: ${details.reason}.`, options);
        this.name = 'InvalidAssertionProtocolError';
        this.details = details;
    }

    public diagnostic(): AssertionProtocolDiagnostic {
        return this.details;
    }
}

export function invalidAssertionProtocol(path: string, reason: string): InvalidAssertionProtocolError {
    return new InvalidAssertionProtocolError({ path, reason }, {});
}

export function protocolObject(value: unknown): value is ProtocolRecord {
    return typeof value === 'object' && value !== null && !types.isProxy(value);
}

export function dataField(record: ProtocolRecord, key: PropertyKey, path: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        throw invalidAssertionProtocol(path, 'expected an own data property');
    }
    const value: unknown = descriptor.value;
    return value;
}

export function protocolItems(value: unknown, path: string): readonly unknown[] {
    if (!protocolObject(value) || !Array.isArray(value)) {
        throw invalidAssertionProtocol(path, 'expected an array');
    }
    const items: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
        items.push(dataField(value, index, `${path}[${index}]`));
    }
    return items;
}

export function nonEmptyProtocolItems(value: unknown, path: string): readonly [unknown, ...unknown[]] {
    const items = protocolItems(value, path);
    if (items.length === 0) {
        throw invalidAssertionProtocol(path, 'expected a non-empty array');
    }
    const [ first, ...rest ] = items;
    return [ first, ...rest ];
}

function protocolRecord(value: unknown, path: string, ancestors: readonly ProtocolRecord[]): ProtocolRecord {
    if (!protocolObject(value) || Array.isArray(value)) {
        throw invalidAssertionProtocol(path, 'expected a protocol record');
    }
    if (ancestors.includes(value)) {
        throw invalidAssertionProtocol(path, 'structural cycle');
    }
    return value;
}

function stringField(record: ProtocolRecord, key: string, path: string): string {
    const value = dataField(record, key, `${path}.${key}`);
    if (typeof value !== 'string') {
        throw invalidAssertionProtocol(`${path}.${key}`, 'expected a string');
    }
    return value;
}

const locationCopies = new WeakMap<ProtocolRecord, SourceLocation>();

function copyLocation(record: ProtocolRecord, next: SourceLocation): SourceLocation {
    const previous = locationCopies.get(record);
    if (
        previous?.kind === next.kind && previous.file === next.file &&
        previous.line === next.line && previous.column === next.column
    ) {
        return previous;
    }
    const copy = Object.freeze(next);
    locationCopies.set(record, copy);
    return copy;
}

function coordinate(record: ProtocolRecord, key: string, path: string): number | null {
    const value = dataField(record, key, `${path}.${key}`);
    if (value === null || typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    throw invalidAssertionProtocol(`${path}.${key}`, 'expected a finite number or null');
}

function location(value: unknown, path: string, ancestors: readonly ProtocolRecord[]): SourceLocation {
    const record = protocolRecord(value, path, ancestors);
    const kind = dataField(record, 'kind', `${path}.kind`);
    if (kind === 'unknown') {
        return copyLocation(record, { kind });
    }
    if (kind !== 'known') {
        throw invalidAssertionProtocol(`${path}.kind`, 'expected known or unknown');
    }
    const file = stringField(record, 'file', path);
    if (file.length === 0) {
        throw invalidAssertionProtocol(`${path}.file`, 'expected a non-empty filename');
    }
    return copyLocation(record, {
        kind,
        file,
        line: coordinate(record, 'line', path),
        column: coordinate(record, 'column', path)
    });
}

type ResolvedLocations = InvalidAssertionProtocolError | NonEmptyReadonlyArray<SourceLocation>;

const resolvedLocations = new WeakMap<ResolvableSourceLocations, ResolvedLocations>();

function providerValue(provider: () => unknown): unknown {
    try {
        return provider();
    } catch {
        return unknownSourceLocation;
    }
}

function resolveLocation(entry: ResolvableSourceLocation, index: number): SourceLocation {
    return typeof entry === 'function'
        ? location(providerValue(entry), `sourceLocations[${index}]`, [])
        : resolveSourceLocation(entry);
}

function resolveLocations(locations: ResolvableSourceLocations): ResolvedLocations {
    try {
        const [ first, ...remaining ] = locations;
        return [
            resolveLocation(first, 0),
            ...remaining.map(function resolveForwarded(entry, index) {
                return resolveLocation(entry, index + 1);
            })
        ];
    } catch (error) {
        if (!(error instanceof InvalidAssertionProtocolError)) {
            throw error;
        }
        return error;
    }
}

export function resolveAssertionLocations(locations: ResolvableSourceLocations): NonEmptyReadonlyArray<SourceLocation> {
    const resolved = resolvedLocations.get(locations) ?? resolveLocations(locations);
    resolvedLocations.set(locations, resolved);
    if (resolved instanceof InvalidAssertionProtocolError) {
        throw resolved;
    }
    return resolved;
}

function foreignError(value: unknown, path: string, ancestors: readonly ProtocolRecord[]): ProtocolRecord {
    const error = protocolRecord(value, path, ancestors);
    const stack = dataField(error, 'stack', `${path}.stack`);
    if (stack !== null && typeof stack !== 'string') {
        throw invalidAssertionProtocol(`${path}.stack`, 'expected a string or null');
    }
    return {
        message: stringField(error, 'message', path),
        name: stringField(error, 'name', path),
        stack,
        thrown: dataField(error, 'thrown', `${path}.thrown`)
    };
}

function foreignResult(value: unknown, path: string, ancestors: readonly ProtocolRecord[]): ProtocolRecord {
    const result = protocolRecord(value, path, ancestors);
    const passed = dataField(result, 'passed', `${path}.passed`);
    if (passed === true) {
        return { passed };
    }
    if (passed !== false) {
        throw invalidAssertionProtocol(`${path}.passed`, 'expected a boolean');
    }
    const errorPath = `${path}.error`;
    return { passed, error: foreignError(dataField(result, 'error', errorPath), errorPath, [ ...ancestors, result ]) };
}

type NodeAdmission = {
    readonly source: AssertionSource;
    readonly path: string;
    readonly ancestors: readonly ProtocolRecord[];
    readonly child: boolean;
    readonly originals: WeakMap<ProtocolRecord, ProtocolRecord>;
};

function isBuiltInCheck(check: string): check is keyof typeof fieldsByCheck {
    return Object.hasOwn(fieldsByCheck, check);
}

function isLocationProvider(value: unknown): value is () => SourceLocation {
    return typeof value === 'function';
}

function nodeLocations(record: ProtocolRecord, admission: NodeAdmission): readonly ResolvableSourceLocation[] {
    const { path, ancestors } = admission;
    const locationsPath = `${path}.sourceLocations`;
    return nonEmptyProtocolItems(dataField(record, 'sourceLocations', locationsPath), locationsPath)
        .map(function admitLocation(entry, index) {
            const entryPath = `${locationsPath}[${index}]`;
            if (!isLocationProvider(entry)) {
                return location(entry, entryPath, [ ...ancestors, record ]);
            }
            return entry;
        });
}

function nodeMessage(record: ProtocolRecord, path: string): string | null {
    const message = dataField(record, 'message', `${path}.message`);
    if (message !== null && typeof message !== 'string') {
        throw invalidAssertionProtocol(`${path}.message`, 'expected a string or null');
    }
    return message;
}

function isAllowedBuiltInCheck(check: string, admission: NodeAdmission): check is keyof typeof fieldsByCheck {
    return isBuiltInCheck(check) &&
        (admission.child || admission.source === 'assert' || requireChecks.has(check));
}

function readLeafFields(
    record: ProtocolRecord,
    fields: Readonly<Record<string, FieldRule>>,
    path: string
): ProtocolRecord {
    const admitted: Record<string, unknown> = {};
    for (const key of Object.keys(fields)) {
        const fieldPath = `${path}.${key}`;
        const value = dataField(record, key, fieldPath);
        if (fields[key]?.(value) !== true) {
            throw invalidAssertionProtocol(fieldPath, 'invalid value for this check');
        }
        admitted[key] = value;
    }
    return admitted;
}

function leafFields(record: ProtocolRecord, check: string, admission: NodeAdmission): ProtocolRecord {
    const { path, child, ancestors } = admission;
    if (check === 'foreign' && child) {
        return {
            label: stringField(record, 'label', path),
            summary: stringField(record, 'summary', path),
            result: foreignResult(dataField(record, 'result', `${path}.result`), `${path}.result`, [
                ...ancestors,
                record
            ])
        };
    }
    if (!isAllowedBuiltInCheck(check, admission)) {
        throw invalidAssertionProtocol(`${path}.check`, 'unsupported check for this assertion position');
    }
    return readLeafFields(record, fieldsByCheck[check], path);
}

function compositeFields(
    record: ProtocolRecord,
    admission: NodeAdmission,
    admitChild: (value: unknown, admission: NodeAdmission) => ProtocolRecord
): ProtocolRecord {
    const { path, ancestors } = admission;
    const childrenPath = `${path}.children`;
    const children = nonEmptyProtocolItems(dataField(record, 'children', childrenPath), childrenPath);
    return {
        actual: dataField(record, 'actual', `${path}.actual`),
        expected: dataField(record, 'expected', `${path}.expected`),
        name: stringField(record, 'name', path),
        summary: stringField(record, 'summary', path),
        children: children.map(function admitEntry(entry, index) {
            return admitChild(entry, {
                ...admission,
                path: `${childrenPath}[${index}]`,
                child: true,
                ancestors: [ ...ancestors, record ]
            });
        })
    };
}

function validateSource(record: ProtocolRecord, source: AssertionSource, path: string): void {
    if (dataField(record, 'source', `${path}.source`) !== source) {
        throw invalidAssertionProtocol(`${path}.source`, `expected ${source}`);
    }
}

function admitNode(value: unknown, admission: NodeAdmission): ProtocolRecord {
    const { source, path, ancestors, originals } = admission;
    const record = protocolRecord(value, path, ancestors);
    const check = stringField(record, 'check', path);
    validateSource(record, source, path);
    const message = nodeMessage(record, path);
    const fields = check === 'composite' && !admission.child
        ? compositeFields(record, admission, admitNode)
        : leafFields(record, check, admission);
    const node = { check, message, source, sourceLocations: nodeLocations(record, admission), ...fields };
    originals.set(node, record);
    return node;
}

export function admitAssertion<Source extends AssertionSource>(
    value: unknown,
    source: Source,
    path: string,
    originals: WeakMap<ProtocolRecord, ProtocolRecord>
): Extract<AssertionNode, { readonly source: Source; }>;
export function admitAssertion(
    value: unknown,
    source: AssertionSource,
    path: string,
    originals: WeakMap<ProtocolRecord, ProtocolRecord>
): ProtocolRecord {
    return admitNode(value, { source, path, ancestors: [], child: false, originals });
}

export function admitCompositeChild<Source extends AssertionSource>(
    value: unknown,
    source: Source,
    path: string
): CompositeAssertionChildNode<Source>;
export function admitCompositeChild(value: unknown, source: AssertionSource, path: string): ProtocolRecord {
    return admitNode(value, { source, path, ancestors: [], child: true, originals: new WeakMap() });
}

export function assertCompositeChild<Source extends AssertionSource>(
    value: unknown,
    source: Source,
    path: string
): asserts value is CompositeAssertionChildNode<Source> {
    admitCompositeChild(value, source, path);
}

function builtInLocation(entry: ResolvableSourceLocation, index: number): ResolvableSourceLocation {
    return isLocationProvider(entry) ? entry : location(entry, `sourceLocations[${index}]`, []);
}

function builtInLocations(locations: ResolvableSourceLocations): ResolvableSourceLocations {
    const [ first, ...remaining ] = locations;
    if (remaining.length === 0) {
        return [ builtInLocation(first, 0) ];
    }
    return [
        builtInLocation(first, 0),
        ...remaining.map(function normalize(entry, index) {
            return builtInLocation(entry, index + 1);
        })
    ];
}

function validateBuiltInFields(assertion: AssertionNode, fields: Readonly<Record<string, FieldRule>>): void {
    for (const key of Object.keys(fields)) {
        if (fields[key]?.(Reflect.get(assertion, key)) !== true) {
            throw invalidAssertionProtocol(`assertion.${key}`, 'invalid value for this check');
        }
    }
}

function validateBuiltInArguments(assertion: AssertionNode): void {
    if (assertion.check === 'composite') {
        throw invalidAssertionProtocol('assertion.check', 'expected a built-in check');
    }
    const fields: Readonly<Record<string, FieldRule>> = fieldsByCheck[assertion.check];
    if (fields === actualFields || fields === comparisonFields) {
        return;
    }
    validateBuiltInFields(assertion, fields);
}

export function admitBuiltInAssertion<Node extends AssertionNode>(assertion: Node): Node {
    if (assertion.message !== null && typeof assertion.message !== 'string') {
        throw invalidAssertionProtocol('assertion.message', 'expected a string or null');
    }
    validateBuiltInArguments(assertion);
    return { ...assertion, sourceLocations: builtInLocations(assertion.sourceLocations) };
}

export function matchesDataField(original: ProtocolRecord, key: PropertyKey, expected: unknown): boolean {
    const descriptor = Object.getOwnPropertyDescriptor(original, key);
    return descriptor !== undefined && Object.hasOwn(descriptor, 'value') && Object.is(descriptor.value, expected);
}

function matchesLocations(original: ProtocolRecord, expected: ResolvableSourceLocations): boolean {
    const descriptor = Object.getOwnPropertyDescriptor(original, 'sourceLocations');
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) {
        return false;
    }
    const locations: unknown = descriptor.value;
    return protocolObject(locations) && Array.isArray(locations) && locations.length === expected.length &&
        expected.every(function unchangedLocation(entry, index) {
            return matchesDataField(locations, index, entry);
        });
}

export function matchesRecordedLeaf(original: ProtocolRecord, recorded: AssertionNode): boolean {
    if (recorded.check === 'composite' || !matchesLocations(original, recorded.sourceLocations)) {
        return false;
    }
    return Object.keys(recorded).every(function unchangedField(key) {
        return key === 'sourceLocations' || matchesDataField(original, key, Reflect.get(recorded, key));
    });
}
