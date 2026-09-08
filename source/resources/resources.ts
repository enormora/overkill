const resourceDefinitionBrand: unique symbol = Symbol('overkill.resourceDefinition');
const runtimeDefinitionBrand: unique symbol = Symbol('overkill.runtimeDefinition');

type Awaitable<Value> = Promise<Value> | Value;
type ExclusiveResource = { readonly kind: 'exclusive-resource'; readonly name: string; };
type SerialExecution = { readonly kind: 'serial'; };
type SingleWorkerExecution = { readonly kind: 'single-worker'; };
type StartupBudget = {
    readonly kind: 'startup-budget-milliseconds';
    readonly minimumMilliseconds: number;
};
type AnyResourceDefinition = {
    readonly name: string;
    readonly scope: ResourceScope;
    readonly requirements: readonly ExecutionRequirement[];
    readonly acquire: (context: ResourceCreationContext) => Awaitable<unknown>;
    readonly dispose: ((handle: never, context: ResourceDisposalContext) => Awaitable<void>) | null;
    readonly [resourceDefinitionBrand]: true;
};
type RuntimeResourceMap = Readonly<Record<string, AnyResourceDefinition>>;

export type RuntimeDimensions = Readonly<Record<string, string>>;

export type RuntimeId<
    Name extends string = string,
    Dimensions extends RuntimeDimensions = RuntimeDimensions
> = {
    readonly name: Name;
    readonly dimensions: Dimensions;
};

export type ExecutionRequirement = ExclusiveResource | SerialExecution | SingleWorkerExecution | StartupBudget;

export type ResourceScope = 'per-case' | 'per-file' | 'per-run' | 'per-suite' | 'shared-per-worker';

export type ResourceCreationContext = {
    readonly signal: AbortSignal;
};

export type ResourceDisposalContext = {
    readonly signal: AbortSignal;
};

export type ResourceDefinitionInput<Name extends string, Handle> = {
    readonly name: Name;
    readonly scope: ResourceScope;
    readonly requirements: readonly ExecutionRequirement[];
    readonly acquire: (context: ResourceCreationContext) => Awaitable<Handle>;
    readonly dispose: ((handle: Handle, context: ResourceDisposalContext) => Awaitable<void>) | null;
};

export type ResourceDefinition<Name extends string = string, Handle = unknown> = {
    readonly name: Name;
    readonly scope: ResourceScope;
    readonly requirements: readonly ExecutionRequirement[];
    readonly acquire: (context: ResourceCreationContext) => Awaitable<Handle>;
    readonly dispose: ((handle: Handle, context: ResourceDisposalContext) => Awaitable<void>) | null;
    readonly [resourceDefinitionBrand]: true;
};

type NamedResource<Handle> = ResourceDefinition<string, Handle>;

export type ResourceHandle<Resource extends AnyResourceDefinition> = Resource extends NamedResource<infer Handle>
    ? Handle
    : never;

export type RuntimeDefinitionInput<
    Name extends string,
    Dimensions extends RuntimeDimensions,
    Resources extends RuntimeResourceMap
> = {
    readonly name: Name;
    readonly dimensions: Dimensions;
    readonly resources: Resources;
    readonly requirements: readonly ExecutionRequirement[];
};

export type RuntimeDefinition<
    Name extends string = string,
    Dimensions extends RuntimeDimensions = RuntimeDimensions,
    Resources extends RuntimeResourceMap = RuntimeResourceMap
> = RuntimeDefinitionInput<Name, Dimensions, Resources> & {
    readonly id: RuntimeId<Name, Dimensions>;
    readonly [runtimeDefinitionBrand]: true;
};

export type RuntimeContext<Runtime extends RuntimeDefinition> = {
    readonly [Key in keyof Runtime['resources']]: ResourceHandle<Runtime['resources'][Key]>;
};

export function defineResource<const Name extends string, Handle>(
    definition: ResourceDefinitionInput<Name, Handle>
): ResourceDefinition<Name, Handle> {
    return Object.freeze({
        ...definition,
        [resourceDefinitionBrand]: true as const
    });
}

export function defineRuntime<
    const Name extends string,
    const Dimensions extends RuntimeDimensions,
    const Resources extends RuntimeResourceMap
>(
    definition: RuntimeDefinitionInput<Name, Dimensions, Resources>
): RuntimeDefinition<Name, Dimensions, Resources> {
    return Object.freeze({
        ...definition,
        id: Object.freeze({
            name: definition.name,
            dimensions: definition.dimensions
        }),
        [runtimeDefinitionBrand]: true as const
    });
}
