export type Awaitable<Value> = Promise<Value> | Value;
export type ValueOf<Values> = Values[keyof Values];

type ExclusiveResource = { readonly kind: 'exclusive-resource'; readonly name: string; };
type SerialExecution = { readonly kind: 'serial'; };
type SingleWorkerExecution = { readonly kind: 'single-worker'; };
type StartupBudget = {
    readonly kind: 'startup-budget-milliseconds';
    readonly minimumMilliseconds: number;
};
type CapacityWeight = {
    readonly kind: 'capacity-weight';
    readonly weight: number;
};
type AffinityKey = {
    readonly key: string;
    readonly kind: 'affinity-key';
};
type FaultDomain = {
    readonly key: string;
    readonly kind: 'fault-domain';
};
type DuplicateExecution = {
    readonly kind: 'duplicate-execution';
    readonly safety: 'disposable-isolated' | 'idempotent';
};

type PlacementRequirement = AffinityKey | CapacityWeight | DuplicateExecution | ExclusiveResource | FaultDomain;
type SchedulingRequirement = SerialExecution | SingleWorkerExecution | StartupBudget;

export type ExecutionRequirement = PlacementRequirement | SchedulingRequirement;

export type ResourceScope = 'per-case' | 'per-file' | 'per-run' | 'per-suite' | 'shared-per-worker';

export type AnyResourceDefinition = {
    readonly acquire: (context: never) => Awaitable<unknown>;
    readonly dependencies: ResourceDependencies;
    readonly deserializeHandle?: (payload: never, context: never) => unknown;
    readonly dispose: ((handle: never, context: never) => Awaitable<void>) | null;
    readonly name: string;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: ResourceScope;
    readonly serializeHandle?: (handle: never, context: never) => ResourceProjectionPayload;
};

export type RuntimeResourceMap = Readonly<Record<string, AnyResourceDefinition>>;
export type EmptyResourceDependencies = Readonly<Record<PropertyKey, never>>;
export type ResourceDependencies = Readonly<Record<string, AnyResourceDefinition>>;

type ResourceProjectionObject = { readonly [key: string]: ResourceProjectionPayload; };
type ResourceProjectionScalar = boolean | number | string | null;
type ResourceProjectionCollection = ResourceProjectionObject | readonly ResourceProjectionPayload[];
export type ResourceProjectionPayload = ResourceProjectionCollection | ResourceProjectionScalar;
