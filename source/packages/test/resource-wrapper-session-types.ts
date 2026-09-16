import type {
    AnyResourceDefinition,
    ResourceContext,
    ResourceMap,
    RuntimeContext,
    RuntimeGraph
} from '../resources/resources.entry-point.ts';
import type { RunnerError } from '../../engine/run-result.ts';
import type { TestPlanCase } from '../../engine/test-plan.ts';

export type ManagedRunnerError = RunnerError;

export type DisposalContext = {
    readonly signal: AbortSignal;
};

export type LifecycleMessages = {
    readonly acquisitionFailure: string;
    readonly disposalFailure: string;
};

export type ResourceWrapperResourcesStep = {
    readonly kind: 'resources';
    readonly resources: ResourceMap;
};

export type ResourceWrapperRuntimeStep = {
    readonly kind: 'runtime';
    readonly runtime: RuntimeGraph;
};

export type ResourceWrapperStep = ResourceWrapperResourcesStep | ResourceWrapperRuntimeStep;

export type ComposedResourceSession = {
    readonly directResources: ResourceContext<ResourceMap>;
    readonly disposeOnce: (context: DisposalContext) => Promise<void>;
    readonly runtimeContexts: ReadonlyMap<RuntimeGraph, RuntimeContext<RuntimeGraph>>;
};

export type ResourceEntry = {
    readonly key: string;
    readonly resource: AnyResourceDefinition;
};

export type ManagedLifecycleState = {
    readonly acquireComposedResources: (
        steps: readonly ResourceWrapperStep[],
        signal: AbortSignal,
        messages: LifecycleMessages
    ) => Promise<ComposedResourceSession>;
    readonly runCase: <Value>(testCase: TestPlanCase, run: () => Promise<Value>) => Promise<Value>;
    readonly takeCaseErrors: (testCase: TestPlanCase) => readonly ManagedRunnerError[];
    readonly takeRunErrors: () => readonly ManagedRunnerError[];
};
