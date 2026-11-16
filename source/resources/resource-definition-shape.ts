import type {
    ImplementationReference,
    ImplementationInputContext,
    ImplementationFacts
} from '../implementation-reference.ts';
import type { PortableValue } from '../portable-value.ts';
import type { WorkloadParameters } from '../engine/workload-input.ts';
import type { ResourceWorkload } from './resource-workload-types.ts';
import type { ResourceScenarioSlots } from './resource-scenario.ts';

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

type ResourceCallbacks = {
    readonly acquire: (context: never) => Awaitable<unknown>;
    readonly dispose: ((handle: never, context: never) => Awaitable<void>) | null;
    readonly exposeHandle: ((handle: never, context: never) => unknown) | null;
};
type ReferenceCallbacks = {
    readonly kind: 'resource-reference';
    readonly acquire: null;
    readonly dispose: null;
    readonly exposeHandle: null;
    readonly implementation: ReferencedResourceImplementation;
};
export type AnyResourceDefinition = (ReferenceCallbacks | ResourceCallbacks) & {
    readonly dependencies: ResourceDependencies;
    readonly deserializeHandle?: (payload: never, context: never) => unknown;
    readonly name: string;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scenarios: ResourceScenarioSlots;
    readonly scope: ResourceScope;
    readonly workload: ((parameters: WorkloadParameters) => WorkloadParameters) | null;
    readonly serializeHandle?: (handle: never, context: never) => ResourceProjectionPayload;
};

export type RuntimeResourceMap = Readonly<Record<string, AnyResourceDefinition>>;
export type EmptyResourceDependencies = Readonly<Record<PropertyKey, never>>;
export type ResourceDependencies = Readonly<Record<string, AnyResourceDefinition>>;

type ResourceProjectionObject = { readonly [key: string]: ResourceProjectionPayload; };
type ResourceProjectionScalar = boolean | number | string | null;
type ResourceProjectionCollection = ResourceProjectionObject | readonly ResourceProjectionPayload[];
export type ResourceProjectionPayload = ResourceProjectionCollection | ResourceProjectionScalar;

export type ReferenceAdmission = {
    readonly namespace: unknown;
    readonly facts: ImplementationFacts;
    readonly context: ImplementationInputContext;
};

type NativeOwnerCallbacks = {
    readonly exposeHandle: ((handle: never, context: never) => unknown) | null;
    readonly acquire: (context: never) => Awaitable<unknown>;
    readonly dispose: ((handle: never, context: never) => Awaitable<void>) | null;
    readonly serializeHandle: ((handle: never, context: never) => ResourceProjectionPayload) | null;
};
type NativeConsumerCallbacks = {
    readonly deserializeHandle: (payload: never, context: never) => unknown;
    readonly exposeHandle: ((handle: never, context: never) => unknown) | null;
};
export type ResourceOwnerBinding = {
    readonly reference: ImplementationReference<PortableValue>;
    readonly bind: (admission: ReferenceAdmission) => NativeOwnerCallbacks;
};
export type ResourceConsumerBinding = {
    readonly reference: ImplementationReference<PortableValue>;
    readonly bind: (admission: ReferenceAdmission) => NativeConsumerCallbacks;
};

export type ReferencedResourceImplementation = {
    readonly workload: ResourceWorkload<WorkloadParameters> | null;
    readonly owner: ResourceOwnerBinding;
    readonly consumer: ResourceConsumerBinding | null;
};
