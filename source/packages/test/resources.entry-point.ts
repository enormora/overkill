import type {
    RuntimeAttachments,
    ResourceAttachedTestBody,
    TestBody,
    TestScope
} from '../engine/engine.entry-point.ts';
import {
    isDefinedResource,
    isDefinedRuntimeGraph,
    type AnyResourceDefinition,
    type ResourceContext,
    type ResourceMap,
    type RuntimeGraph,
    type RuntimeScopeContext
} from '../resources/resources.entry-point.ts';
import {
    attachComposedResourceBody
} from './resource-wrapper-composition.ts';
import {
    resourcesWrapperStep,
    resourceWrapperStep,
    runtimeWrapperStep
} from './resource-wrapper-data.ts';

export type {
    AttachmentMetadata,
    AttachmentWriter,
    AttachmentLimits,
    RuntimeAttachments,
    RuntimeAttachmentArtifact
} from '../engine/engine.entry-point.ts';

export {
    composeRuntimeContext,
    composeRuntimes,
    createLocalHttpServiceResource,
    createLocalProcessServiceResource,
    createSimulatedHttpServerResource,
    createTemporaryDirectoryResource,
    defineLocalServiceResource,
    defineResource,
    defineRuntime,
    defineRuntimeMatrix,
    ResourceLifecycleError,
    startRuntime
} from '../resources/resources.entry-point.ts';
export type {
    AnyResourceDefinition,
    ComposedRuntimeGraph,
    ExecutionRequirement,
    ResourceContext,
    ResourceCreationContext,
    ResourceDependencies,
    ResourceDefinition,
    ResourceDefinitionInput,
    ResourceDisposalContext,
    ResourceHandle,
    ResourceProjectionContext,
    ResourceProjectionPayload,
    ResourceLifecycleFailure,
    ResourceLifecyclePhase,
    ResourceMap,
    ResourceScope,
    ResourceScenarioBindings,
    ResourceScenarioSlot,
    ResourceScenarioSlotInput,
    ResourceScenarioSlotInputs,
    ResourceScenarioSlots,
    ResourceScenarioSlotsFromInputs,
    RuntimeContext,
    RuntimeContextComposition,
    RuntimeDefinition,
    RuntimeDefinitionInput,
    RuntimeDimensions,
    RuntimeGraphContext,
    RuntimeGraph,
    RuntimeGraphLeaf,
    RuntimeId,
    RuntimeMatrixDefinition,
    RuntimeMatrixDefinitionInput,
    RuntimeMatrixVariant,
    RuntimeMatrixVariantMap,
    RuntimeResourceMap,
    RuntimeScopeContext,
    RuntimeScenarioOwner,
    ScenarioTiming,
    SharedRuntimeMatrixDefinitionInput,
    RuntimeSession,
    RuntimeSessionDisposalContext,
    StartRuntimeRequest,
    SimulatedHttpServerResource,
    SimulatedHttpServerResourceHandle,
    SimulatedHttpServerResourceOptions,
    HttpHeadersSnapshot,
    HttpInteraction,
    HttpInteractionOutcome,
    HttpRequestSnapshot,
    HttpResponseSnapshot,
    HttpTranscript,
    HttpTranscriptEntry,
    RecordedHttpBody,
    RecordedHttpError,
    TranscriptCaptureErrorEntry,
    TranscriptView,
    TemporaryDirectoryHandle
} from '../resources/resources.entry-point.ts';
export type {
    LocalServiceAddress,
    LocalServiceAddressRequest,
    LocalServiceCreationContext,
    LocalServiceDisposalContext,
    LocalServiceHostAddressRequest,
    LocalServiceLoopbackAddressRequest,
    LocalServiceResourceDefinitionInput,
    LocalOnlyLocalServiceResourceDefinitionInput,
    ProjectedLocalServiceResourceDefinitionInput
} from '../resources/resources.entry-point.ts';
export type {
    LocalHttpServiceHandle,
    LocalHttpServiceResourceInput,
    LocalHttpResourceHandle,
    LocalHttpTranscriptPolicy,
    LocalProcessCommand,
    LocalProcessOutput,
    LocalProcessOutputBuffer,
    LocalProcessOwner,
    LocalProcessServiceResourceInput,
    LocalProcessShutdown,
    LocalProcessSignal
} from '../resources/resources.entry-point.ts';
export type {
    TestBodyDirectResourceAttachmentSummary,
    TestBodyExecutionRequirementSummary,
    TestBodyResourceAttachments,
    TestBodyResourceSummary,
    TestBodyRuntimeSummary
} from '../engine/engine.entry-point.ts';

type ResourceLifecycleScope = Pick<TestScope, 'cleanup' | 'signal'>;

type TestBodyWithScope<Scope extends ResourceLifecycleScope, Result = ReturnType<TestBody>> = (scope: Scope) => Result;

export type RuntimeTestScope<
    Graph extends RuntimeGraph,
    Scope extends ResourceLifecycleScope = TestScope
> = Scope & {
    readonly attachments: RuntimeAttachments;
    readonly runtimes: RuntimeScopeContext<Graph>;
};

export type RuntimeTestBody<
    Graph extends RuntimeGraph,
    Scope extends ResourceLifecycleScope = TestScope,
    Result = ReturnType<TestBody>
> = (scope: RuntimeTestScope<Graph, Scope>) => Promise<Result> | Result;

export type ResourceScopeContext<Resources extends ResourceMap> = ResourceContext<Resources>;

export type ResourceTestScope<
    Resources extends ResourceMap,
    Scope extends ResourceLifecycleScope = TestScope
> = Scope & {
    readonly attachments: RuntimeAttachments;
    readonly resources: ResourceScopeContext<Resources>;
};

export type ResourceTestBody<
    Resources extends ResourceMap,
    Scope extends ResourceLifecycleScope = TestScope,
    Result = ReturnType<TestBody>
> = (scope: ResourceTestScope<Resources, Scope>) => Promise<Result> | Result;

type WrappedBodyResult<Result> = Awaited<Result> extends Awaited<ReturnType<TestBody>> ? Awaited<ReturnType<TestBody>>
    : Awaited<Result>;

type WrappedBody<Scope extends ResourceLifecycleScope, Result> = ResourceAttachedTestBody<
    TestBodyWithScope<Scope, Promise<WrappedBodyResult<Result>>>
>;

export type RuntimeWrappedTestBody<
    Graph extends RuntimeGraph = RuntimeGraph,
    Scope extends ResourceLifecycleScope = TestScope,
    Result = ReturnType<TestBody>
> = Readonly<Record<never, Graph>> & WrappedBody<Scope, Result>;

export type ResourceWrappedTestBody<
    Resources extends ResourceMap = ResourceMap,
    Scope extends ResourceLifecycleScope = TestScope,
    Result = ReturnType<TestBody>
> = Readonly<Record<never, Resources>> & WrappedBody<Scope, Result>;

type ResourceEntry = {
    readonly key: string;
    readonly resource: AnyResourceDefinition;
};

function ensureResource(resource: unknown, wrapperName: string): AnyResourceDefinition {
    if (!isDefinedResource(resource)) {
        throw new TypeError(`${wrapperName}() requires resource descriptors.`);
    }

    return resource;
}

function ensureRuntimeGraph(runtimeGraph: unknown): RuntimeGraph {
    if (!isDefinedRuntimeGraph(runtimeGraph)) {
        throw new TypeError('withRuntime() requires a runtime descriptor.');
    }

    return runtimeGraph;
}

function isResourceMapInput(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readResources(resources: unknown): readonly ResourceEntry[] {
    if (!isResourceMapInput(resources)) {
        throw new TypeError('withResources() requires a resource descriptor map.');
    }

    const resourceEntries = Object.entries(resources);

    if (resourceEntries.length === 0) {
        throw new TypeError('withResources() requires at least one resource descriptor.');
    }

    return resourceEntries.map(function readResource([ key, resource ]) {
        return {
            key,
            resource: ensureResource(resource, 'withResources')
        };
    });
}

export function withRuntime<
    Graph extends RuntimeGraph,
    Scope extends ResourceLifecycleScope = TestScope,
    Result = ReturnType<TestBody>
>(
    runtimeGraph: Graph,
    body: RuntimeTestBody<Graph, Scope, Result>
): RuntimeWrappedTestBody<Graph, Scope, Result> {
    const runtime = ensureRuntimeGraph(runtimeGraph);

    return attachComposedResourceBody<Scope, WrappedBodyResult<Result>>(
        runtimeWrapperStep(runtime),
        body,
        'withRuntime'
    );
}

export function withResource<
    const Resource extends AnyResourceDefinition,
    Scope extends ResourceLifecycleScope = TestScope,
    Result = ReturnType<TestBody>
>(
    resource: Resource,
    body: ResourceTestBody<Record<Resource['name'], Resource>, Scope, Result>
): ResourceWrappedTestBody<Record<Resource['name'], Resource>, Scope, Result> {
    const descriptor = ensureResource(resource, 'withResource');

    return attachComposedResourceBody<Scope, WrappedBodyResult<Result>>(
        resourceWrapperStep(descriptor),
        body,
        'withResource'
    );
}

export function withResources<
    const Resources extends ResourceMap,
    Scope extends ResourceLifecycleScope = TestScope,
    Result = ReturnType<TestBody>
>(
    resources: Resources,
    body: ResourceTestBody<Resources, Scope, Result>
): ResourceWrappedTestBody<Resources, Scope, Result> {
    readResources(resources);

    return attachComposedResourceBody<Scope, WrappedBodyResult<Result>>(
        resourcesWrapperStep(resources),
        body,
        'withResources'
    );
}

export { withFailureArtifacts } from '../resources/resources.entry-point.ts';
export type {
    FailureArtifactAttachments,
    ResourceFailureCapture,
    SimulationWitnessArtifact,
    SimulationWitnessInput
} from '../resources/resources.entry-point.ts';

export type { ResourceWorkload, ResourceWorkloadParser } from '../../resources/resources.ts';
export type { WorkloadInput, WorkloadParameters } from '../../engine/workload-input.ts';
