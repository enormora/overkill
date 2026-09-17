import {
    isDefinedRuntime,
    type RuntimeDefinition,
    type RuntimeDimensions
} from './runtime-definition.ts';
import type { RuntimeResourceMap } from './resource-definition-shape.ts';

const runtimeMatrixDefinitionBrand: unique symbol = Symbol('overkill.runtimeMatrixDefinition');

type RuntimeMatrixVariantValue<
    Shared,
    Dimensions extends RuntimeDimensions,
    Resources extends RuntimeResourceMap
> = RuntimeMatrixVariantValueOptions<
    Shared,
    Dimensions,
    Resources
>[keyof RuntimeMatrixVariantValueOptions<Shared, Dimensions, Resources>];

type RuntimeMatrixVariantValueOptions<
    Shared,
    Dimensions extends RuntimeDimensions,
    Resources extends RuntimeResourceMap
> = {
    readonly factory: (shared: Shared) => RuntimeDefinition<string, Dimensions, Resources>;
    readonly runtime: RuntimeDefinition<string, Dimensions, Resources>;
};

type RuntimeVariantFactoryResult<Variant, Shared> = Variant extends (shared: Shared) => infer Runtime ? Runtime : never;
type ResolvedRuntimeVariant<Variant, Shared> = Extract<
    RuntimeVariantFactoryResult<Variant, Shared> | Variant,
    RuntimeDefinition
>;

export type RuntimeMatrixVariant<
    VariantId extends string = string,
    Runtime extends RuntimeDefinition = RuntimeDefinition
> = {
    readonly id: VariantId;
    readonly runtime: Runtime;
};

type RuntimeMatrixVariantMap = Readonly<Record<string, RuntimeMatrixVariant>>;

type ResolvedRuntimeMatrixVariants<
    Variants extends Readonly<Record<string, RuntimeMatrixVariantValue<Shared, RuntimeDimensions, RuntimeResourceMap>>>,
    Shared
> = {
    readonly [VariantId in keyof Variants]: RuntimeMatrixVariant<
        VariantId & string,
        ResolvedRuntimeVariant<Variants[VariantId], Shared>
    >;
};

export type RuntimeMatrixDefinition<
    Name extends string = string,
    Variants extends RuntimeMatrixVariantMap = RuntimeMatrixVariantMap
> = {
    readonly kind: 'runtime-matrix';
    readonly name: Name;
    readonly variants: Variants;
    readonly [runtimeMatrixDefinitionBrand]: true;
};

export type RuntimeGraph = RuntimeDefinition | RuntimeMatrixDefinition;

export type RuntimeMatrixDefinitionInput<
    Name extends string,
    Variants extends Readonly<Record<string, RuntimeMatrixVariantValue<never, RuntimeDimensions, RuntimeResourceMap>>>
> = {
    readonly name: Name;
    readonly variants: Variants;
};

export type SharedRuntimeMatrixDefinitionInput<
    Name extends string,
    Shared,
    Variants extends Readonly<Record<string, RuntimeMatrixVariantValue<Shared, RuntimeDimensions, RuntimeResourceMap>>>
> = {
    readonly name: Name;
    readonly shared: Shared;
    readonly variants: Variants;
};

type RuntimeMatrixInput = RuntimeMatrixInputOptions[keyof RuntimeMatrixInputOptions];

type RuntimeMatrixInputOptions = {
    readonly plain: RuntimeMatrixDefinitionInput<string, Readonly<Record<string, RuntimeDefinition>>>;
    readonly shared: SharedRuntimeMatrixDefinitionInput<
        string,
        unknown,
        Readonly<Record<string, RuntimeMatrixVariantValue<unknown, RuntimeDimensions, RuntimeResourceMap>>>
    >;
};

type VariantState = {
    readonly dimensionIdentities: ReadonlySet<string>;
    readonly dimensionKeys: readonly string[];
    readonly resourceKeys: readonly string[];
};
type RuntimeMatrixEntry = readonly [
    string,
    RuntimeDefinition | ((shared: unknown) => RuntimeDefinition)
];
type RuntimeMatrixEntries = readonly [RuntimeMatrixEntry, ...RuntimeMatrixEntry[]];

const descriptorNamePattern = /^[A-Za-z0-9._-]+$/u;

function assertDescriptorName(kind: string, name: string): void {
    if (!descriptorNamePattern.test(name)) {
        throw new TypeError(`${kind} "${name}" must match ${descriptorNamePattern.source}.`);
    }
}

function compareStrings(left: string, right: string): number {
    return left.localeCompare(right);
}

function sortedKeys(record: Readonly<Record<string, unknown>>): readonly string[] {
    return Object.keys(record).toSorted(compareStrings);
}

function sameStringItems(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every(function itemMatches(item, index) {
        return item === right[index];
    });
}

function dimensionIdentity(dimensions: RuntimeDimensions): string {
    return JSON.stringify(
        sortedKeys(dimensions).map(function toEntry(key) {
            return [ key, dimensions[key] ];
        })
    );
}

function resolveMatrixRuntime(
    variant: RuntimeDefinition | ((shared: unknown) => RuntimeDefinition),
    shared: unknown
): RuntimeDefinition {
    return typeof variant === 'function' ? variant(shared) : variant;
}

function assertMatrixVariantRuntime(variantId: string, runtime: RuntimeDefinition): void {
    if (!isDefinedRuntime(runtime)) {
        throw new TypeError(`Runtime matrix variant "${variantId}" must resolve to a runtime descriptor.`);
    }
}

function assertSameShape(matrixName: string, variantId: string, runtime: RuntimeDefinition, state: VariantState): void {
    if (!sameStringItems(sortedKeys(runtime.dimensions), state.dimensionKeys)) {
        throw new TypeError(`Runtime matrix "${matrixName}" variant "${variantId}" has different dimension keys.`);
    }

    if (!sameStringItems(sortedKeys(runtime.resources), state.resourceKeys)) {
        throw new TypeError(`Runtime matrix "${matrixName}" variant "${variantId}" has different resource keys.`);
    }
}

function nextVariantState(
    matrixName: string,
    variantId: string,
    runtime: RuntimeDefinition,
    state: VariantState
): VariantState {
    const key = dimensionIdentity(runtime.dimensions);

    if (state.dimensionIdentities.has(key)) {
        throw new TypeError(
            `Runtime matrix "${matrixName}" variant "${variantId}" duplicates another dimension tuple.`
        );
    }

    return {
        ...state,
        dimensionIdentities: new Set([ ...state.dimensionIdentities, key ])
    };
}

function runtimeMatrixVariant(variantId: string, runtime: RuntimeDefinition): RuntimeMatrixVariant {
    return Object.freeze({
        id: variantId,
        runtime
    });
}

function readShared(definition: RuntimeMatrixInput): unknown {
    return Object.hasOwn(definition, 'shared') ? Reflect.get(definition, 'shared') : undefined;
}

function initialVariantState(runtime: RuntimeDefinition): VariantState {
    return {
        dimensionIdentities: new Set<string>(),
        dimensionKeys: sortedKeys(runtime.dimensions),
        resourceKeys: sortedKeys(runtime.resources)
    };
}

function runtimeMatrixEntries(definition: RuntimeMatrixInput): RuntimeMatrixEntries {
    const variantEntries = Object.entries(definition.variants);
    const firstVariant = variantEntries[0];

    if (firstVariant === undefined) {
        throw new TypeError(`Runtime matrix "${definition.name}" requires at least one variant.`);
    }

    return [ firstVariant, ...variantEntries.slice(1) ];
}

function firstRuntime(
    variantId: string,
    variantInput: RuntimeDefinition | ((shared: unknown) => RuntimeDefinition),
    shared: unknown
): RuntimeDefinition {
    assertDescriptorName('Runtime matrix variant', variantId);
    const runtime = resolveMatrixRuntime(variantInput, shared);
    assertMatrixVariantRuntime(variantId, runtime);

    return runtime;
}

function matrixVariantEntry(
    matrixName: string,
    variantId: string,
    runtime: RuntimeDefinition,
    state: VariantState
): readonly [string, RuntimeMatrixVariant, VariantState] {
    assertDescriptorName('Runtime matrix variant', variantId);
    assertMatrixVariantRuntime(variantId, runtime);
    assertSameShape(matrixName, variantId, runtime, state);

    return [
        variantId,
        runtimeMatrixVariant(variantId, runtime),
        nextVariantState(matrixName, variantId, runtime, state)
    ];
}

function variantRecord(entries: readonly (readonly [string, RuntimeMatrixVariant])[]): RuntimeMatrixVariantMap {
    const variants: Record<string, RuntimeMatrixVariant> = Object.fromEntries(entries);

    return Object.freeze(variants);
}

function runtimeMatrixVariants(definition: RuntimeMatrixInput): RuntimeMatrixVariantMap {
    const variantEntries = runtimeMatrixEntries(definition);
    const shared = readShared(definition);
    const [ firstVariantId, firstVariantInput ] = variantEntries[0];
    const firstRuntimeValue = firstRuntime(firstVariantId, firstVariantInput, shared);
    let state = initialVariantState(firstRuntimeValue);

    const variants = variantEntries.map(function matrixVariant([ variantId, variantInput ]) {
        const runtime = variantId === firstVariantId ? firstRuntimeValue : resolveMatrixRuntime(variantInput, shared);
        const [ key, variant, nextState ] = matrixVariantEntry(definition.name, variantId, runtime, state);

        state = nextState;

        return [ key, variant ] as const;
    });

    return variantRecord(variants);
}

export function defineRuntimeMatrix<
    const Name extends string,
    const Dimensions extends RuntimeDimensions,
    const Resources extends RuntimeResourceMap,
    const Variants extends Readonly<Record<string, RuntimeDefinition<string, Dimensions, Resources>>>
>(
    definition: RuntimeMatrixDefinitionInput<Name, Variants>
): RuntimeMatrixDefinition<Name, ResolvedRuntimeMatrixVariants<Variants, never>>;
export function defineRuntimeMatrix<
    const Name extends string,
    Shared,
    const Dimensions extends RuntimeDimensions,
    const Resources extends RuntimeResourceMap,
    const Variants extends Readonly<Record<string, RuntimeMatrixVariantValue<Shared, Dimensions, Resources>>>
>(
    definition: SharedRuntimeMatrixDefinitionInput<Name, Shared, Variants>
): RuntimeMatrixDefinition<Name, ResolvedRuntimeMatrixVariants<Variants, Shared>>;
export function defineRuntimeMatrix(
    definition: RuntimeMatrixInput
): RuntimeMatrixDefinition {
    assertDescriptorName('Runtime matrix', definition.name);

    return Object.freeze({
        kind: 'runtime-matrix',
        name: definition.name,
        variants: runtimeMatrixVariants(definition),
        [runtimeMatrixDefinitionBrand]: true as const
    });
}

export function isDefinedRuntimeMatrix(runtime: unknown): runtime is RuntimeMatrixDefinition {
    return typeof runtime === 'object' &&
        runtime !== null &&
        Reflect.get(runtime, runtimeMatrixDefinitionBrand) === true;
}
