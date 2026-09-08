import type { Metadata, TestFamily } from '../engine/engine.entry-point.ts';

export type AuthoringMetadata = {
    readonly baselines?: never;
    readonly capabilities?: never;
    readonly capture?: never;
    readonly debug?: never;
    readonly extra?: Readonly<Record<string, unknown>>;
    readonly kind?: never;
    readonly ownership?: never;
    readonly priority?: never;
    readonly runtimes?: never;
    readonly stability?: never;
    readonly tags?: readonly string[];
    readonly timeoutMilliseconds?: never;
};

type TestFacadeMetadata = {
    readonly metadata: AuthoringMetadata;
    readonly testFamily: TestFamily;
};
type TestFacadeWithoutMetadata = {
    readonly testFamily: TestFamily;
};

export type TestFacadeDefinition = TestFacadeMetadata | TestFacadeWithoutMetadata;

export type ReadTestFacadeDefinitionResult = {
    readonly metadata: Metadata;
    readonly testFamily: TestFamily;
};

const createTestFacadeArgumentsError = 'createTestFacade() requires ({ testFamily, metadata? }).';
const testFamilyValues: readonly TestFamily[] = [
    'benchmark',
    'integration',
    'microtest',
    'property',
    'type-test'
] as const;
const knownTestFamilies: ReadonlySet<unknown> = new Set(testFamilyValues);

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

function readTestFamily(value: unknown): TestFamily {
    if (!isTestFamily(value)) {
        throw new TypeError(createTestFacadeArgumentsError);
    }

    return value;
}

function readStringArray(value: unknown, field: string): readonly string[] {
    if (!Array.isArray(value)) {
        throw new TypeError(`Metadata field "${field}" must be an array.`);
    }

    const items: string[] = [];

    for (const item of value) {
        if (typeof item !== 'string' || item.trim().length === 0) {
            throw new TypeError(`Metadata field "${field}" must contain non-empty strings.`);
        }

        items.push(item);
    }

    return items;
}

function readExtra(value: unknown): Readonly<Record<string, unknown>> {
    if (!isRecord(value)) {
        throw new TypeError('Metadata field "extra" must be an object.');
    }

    return value;
}

function readTagsMetadata(value: Readonly<Record<string, unknown>>): Pick<Metadata, 'tags'> {
    return Object.hasOwn(value, 'tags') ? { tags: readStringArray(value.tags, 'tags') } : {};
}

function readExtraMetadata(value: Readonly<Record<string, unknown>>): Pick<Metadata, 'extra'> {
    return Object.hasOwn(value, 'extra') ? { extra: readExtra(value.extra) } : {};
}

export function readAuthoringMetadata(value: unknown): Metadata {
    const metadata = readRecord(value, 'Test node metadata must be an object.');

    return {
        ...readTagsMetadata(metadata),
        ...readExtraMetadata(metadata)
    };
}

function metadataField<Field extends 'extra' | 'tags'>(
    metadata: Metadata,
    field: Field
): Metadata[Field] | undefined {
    return Object.hasOwn(metadata, field) ? metadata[field] : undefined;
}

function mergedTags(facadeMetadata: Metadata, nodeMetadata: Metadata): Metadata['tags'] | undefined {
    const facadeTags = metadataField(facadeMetadata, 'tags');
    const nodeTags = metadataField(nodeMetadata, 'tags');

    if (facadeTags !== undefined && nodeTags !== undefined) {
        return Array.from(new Set([ ...facadeTags, ...nodeTags ]));
    }

    return nodeTags ?? facadeTags;
}

function mergedExtra(facadeMetadata: Metadata, nodeMetadata: Metadata): Metadata['extra'] | undefined {
    const facadeExtra = metadataField(facadeMetadata, 'extra');
    const nodeExtra = metadataField(nodeMetadata, 'extra');

    if (facadeExtra !== undefined && nodeExtra !== undefined) {
        return { ...facadeExtra, ...nodeExtra };
    }

    return nodeExtra ?? facadeExtra;
}

export function createAuthoringMetadata(
    testFamily: TestFamily,
    facadeMetadata: Metadata,
    nodeMetadata: Metadata
): Metadata {
    const tags = mergedTags(facadeMetadata, nodeMetadata);
    const extra = mergedExtra(facadeMetadata, nodeMetadata);

    return {
        kind: testFamily,
        ...tags === undefined ? {} : { tags },
        ...extra === undefined ? {} : { extra }
    };
}

export function readTestFacadeDefinition(definition: TestFacadeDefinition): ReadTestFacadeDefinitionResult {
    const facadeDefinition = readRecord(definition, createTestFacadeArgumentsError);
    const metadata = Object.hasOwn(facadeDefinition, 'metadata')
        ? readAuthoringMetadata(facadeDefinition.metadata)
        : {};

    return {
        metadata,
        testFamily: readTestFamily(facadeDefinition.testFamily)
    };
}
