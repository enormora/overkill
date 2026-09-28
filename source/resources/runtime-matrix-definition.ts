import {
    isDefinedRuntime,
    type RuntimeDefinition,
    type RuntimeDimensions
} from './runtime-definition.ts';
import type { RuntimeResourceMap } from './resource-definition-shape.ts';
import type {
    EmptyResourceScenarioSlots,
    ResourceScenarioSlots,
    ScenarioBindingInput
} from './resource-scenario.ts';

const runtimeMatrixDefinitionBrand: unique symbol = Symbol('overkill.runtimeMatrixDefinition');
const composedRuntimeGraphBrand: unique symbol = Symbol('overkill.composedRuntimeGraph');

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

type UnionToIntersection<Value> = (
    Value extends unknown ? (value: Value) => void : never
) extends (value: infer Intersection) => void ? Intersection : never;

type RuntimeDefinitionScenarios<Runtime> = Runtime extends RuntimeDefinition<
    string,
    RuntimeDimensions,
    RuntimeResourceMap,
    infer Scenarios
> ? Scenarios
    : EmptyResourceScenarioSlots;

type RuntimeVariantsScenarios<Variants extends RuntimeMatrixVariantMap> = UnionToIntersection<
    RuntimeDefinitionScenarios<Variants[keyof Variants]['runtime']>
> extends infer Scenarios extends ResourceScenarioSlots ? Scenarios : EmptyResourceScenarioSlots;

type CombinedRuntimeScenarios<Runtime extends RuntimeGraph> = UnionToIntersection<
    RuntimeGraphScenarioSlots<Runtime>
> extends infer Scenarios extends ResourceScenarioSlots ? Scenarios : EmptyResourceScenarioSlots;

type RuntimeLeafScenarioSlots<Graph extends RuntimeGraph> = Graph extends RuntimeMatrixDefinition<
    string,
    infer Variants
> ? RuntimeVariantsScenarios<Variants>
    : RuntimeDefinitionScenarios<Graph>;

type RuntimeGraphScenarioSlots<Graph extends RuntimeGraph> = Graph extends ComposedRuntimeGraph<infer Runtimes>
    ? CombinedRuntimeScenarios<Runtimes[number]>
    : RuntimeLeafScenarioSlots<Graph>;

type RuntimeGraphScenarioMethod<Scenarios extends ResourceScenarioSlots, Result> = <
    const Bindings extends Readonly<Record<string, string>>
>(bindings: Bindings & ScenarioBindingInput<Scenarios, Bindings>) => Result;

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
    readonly scenario: RuntimeGraphScenarioMethod<
        RuntimeVariantsScenarios<Variants>,
        RuntimeMatrixDefinition<Name, Variants>
    >;
    readonly scenarios: RuntimeVariantsScenarios<Variants>;
    readonly variants: Variants;
    readonly [runtimeMatrixDefinitionBrand]: true;
};

export type RuntimeGraphLeaf = RuntimeDefinition | RuntimeMatrixDefinition;

export type ComposedRuntimeGraph<
    Runtimes extends readonly RuntimeGraphLeaf[] = readonly RuntimeGraphLeaf[]
> = {
    readonly kind: 'composed-runtimes';
    readonly scenario: RuntimeGraphScenarioMethod<
        CombinedRuntimeScenarios<Runtimes[number]>,
        ComposedRuntimeGraph<Runtimes>
    >;
    readonly scenarios: CombinedRuntimeScenarios<Runtimes[number]>;
    readonly runtimes: Runtimes;
    readonly [composedRuntimeGraphBrand]: true;
};

export type RuntimeGraph = ComposedRuntimeGraph | RuntimeGraphLeaf;

type FlattenRuntimeGraph<Graph extends RuntimeGraph> = Graph extends ComposedRuntimeGraph<infer Runtimes>
    ? Runtimes[number]
    : Extract<Graph, RuntimeGraphLeaf>;
type FlattenRuntimeGraphs<Graphs extends readonly RuntimeGraph[]> = {
    readonly [Key in keyof Graphs]: FlattenRuntimeGraph<Graphs[Key]>;
};

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
    readonly scenarioShape: string;
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

function scenarioShape(scenarios: ResourceScenarioSlots): string {
    return JSON.stringify(
        Object.entries(scenarios).toSorted(function compareScenarioEntries(left, right) {
            return left[0].localeCompare(right[0]);
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

    if (scenarioShape(runtime.scenarios) !== state.scenarioShape) {
        throw new TypeError(`Runtime matrix "${matrixName}" variant "${variantId}" has different scenario slots.`);
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
        resourceKeys: sortedKeys(runtime.resources),
        scenarioShape: scenarioShape(runtime.scenarios)
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

    const variants = runtimeMatrixVariants(definition);
    const firstVariant = Object.values(variants)[0];

    if (firstVariant === undefined) {
        throw new TypeError(`Runtime matrix "${definition.name}" requires at least one variant.`);
    }

    const scenario = function bindRuntimeMatrixScenario(
        bindings: Readonly<Record<string, string>>
    ): RuntimeMatrixDefinition {
        const boundVariants = Object.fromEntries(
            Object.entries(variants).map(function bindVariant([ id, variant ]) {
                return [ id, { id: variant.id, runtime: variant.runtime.scenario(bindings) } ];
            })
        );

        return Object.freeze({
            kind: 'runtime-matrix',
            name: definition.name,
            scenario,
            scenarios: firstVariant.runtime.scenarios,
            variants: Object.freeze(boundVariants),
            [runtimeMatrixDefinitionBrand]: true as const
        });
    };

    return Object.freeze({
        kind: 'runtime-matrix',
        name: definition.name,
        scenario,
        scenarios: firstVariant.runtime.scenarios,
        variants,
        [runtimeMatrixDefinitionBrand]: true as const
    });
}

export function isDefinedRuntimeMatrix(runtime: unknown): runtime is RuntimeMatrixDefinition {
    return typeof runtime === 'object' &&
        runtime !== null &&
        Reflect.get(runtime, runtimeMatrixDefinitionBrand) === true;
}

export function runtimeGraphLeaves(runtime: RuntimeGraph): readonly RuntimeGraphLeaf[] {
    return runtime.kind === 'composed-runtimes' ? runtime.runtimes : [ runtime ];
}

function duplicateRuntimeName(name: string): TypeError {
    return new TypeError(`Runtime scope "${name}" is attached multiple times.`);
}

function assertUniqueRuntimeNames(runtimes: readonly RuntimeGraphLeaf[]): void {
    const names = new Set<string>();

    for (const runtime of runtimes) {
        if (names.has(runtime.name)) {
            throw duplicateRuntimeName(runtime.name);
        }

        names.add(runtime.name);
    }
}

function assertUniqueScenarioSlots(runtimes: readonly RuntimeGraphLeaf[]): void {
    const slots = new Set<string>();

    for (const runtime of runtimes) {
        for (const slot of Object.keys(runtime.scenarios)) {
            if (slots.has(slot)) {
                throw new TypeError(`Scenario slot "${slot}" is attached multiple times.`);
            }

            slots.add(slot);
        }
    }
}

function flattenRuntimeGraphs(runtimes: readonly RuntimeGraph[]): readonly RuntimeGraphLeaf[] {
    return runtimes.flatMap(runtimeGraphLeaves);
}

function combinedScenarioSlots(runtimes: readonly RuntimeGraphLeaf[]): ResourceScenarioSlots {
    return Object.freeze(Object.fromEntries(runtimes.flatMap(function runtimeScenarioEntries(runtime) {
        return Object.entries(runtime.scenarios);
    })));
}

export function composeRuntimes<
    const Runtimes extends readonly [RuntimeGraph, ...RuntimeGraph[]]
>(
    ...runtimes: Runtimes
): ComposedRuntimeGraph<FlattenRuntimeGraphs<Runtimes>>;
export function composeRuntimes(
    ...runtimes: readonly RuntimeGraph[]
): ComposedRuntimeGraph {
    if (runtimes.length === 0) {
        throw new TypeError('composeRuntimes() requires at least one runtime graph.');
    }

    const flattened = flattenRuntimeGraphs(runtimes);

    assertUniqueRuntimeNames(flattened);
    assertUniqueScenarioSlots(flattened);

    const scenarios = combinedScenarioSlots(flattened);
    const scenario = function bindComposedRuntimeScenario(
        bindings: Readonly<Record<string, string>>
    ): ComposedRuntimeGraph {
        const boundRuntimes = flattened.map(function bindChildRuntime(runtime) {
            const childBindings = Object.fromEntries(
                Object.entries(bindings).filter(function childBinding([ name ]) {
                    return Object.hasOwn(runtime.scenarios, name);
                })
            );

            return runtime.scenario(childBindings);
        });

        const [ firstBoundRuntime, ...remainingBoundRuntimes ] = boundRuntimes;

        if (firstBoundRuntime === undefined) {
            throw new TypeError('Composed runtime graph requires at least one runtime.');
        }

        return composeRuntimes(firstBoundRuntime, ...remainingBoundRuntimes);
    };

    const descriptor: ComposedRuntimeGraph = Object.freeze({
        kind: 'composed-runtimes',
        scenario,
        scenarios,
        runtimes: Object.freeze(Array.from(flattened)),
        [composedRuntimeGraphBrand]: true as const
    });

    return descriptor;
}

export function isComposedRuntimeGraph(runtime: unknown): runtime is ComposedRuntimeGraph {
    return typeof runtime === 'object' &&
        runtime !== null &&
        Reflect.get(runtime, composedRuntimeGraphBrand) === true;
}
