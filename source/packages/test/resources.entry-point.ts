import type {
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

export {
    composeRuntimeContext,
    createTemporaryDirectoryResource,
    defineResource,
    defineRuntime,
    defineRuntimeMatrix,
    ResourceLifecycleError,
    startRuntime
} from '../resources/resources.entry-point.ts';
export type {
    AnyResourceDefinition,
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
    RuntimeContext,
    RuntimeContextComposition,
    RuntimeDefinition,
    RuntimeDefinitionInput,
    RuntimeDimensions,
    RuntimeGraphContext,
    RuntimeGraph,
    RuntimeId,
    RuntimeMatrixDefinition,
    RuntimeMatrixDefinitionInput,
    RuntimeMatrixVariant,
    RuntimeMatrixVariantMap,
    RuntimeResourceMap,
    RuntimeScopeContext,
    SharedRuntimeMatrixDefinitionInput,
    RuntimeSession,
    RuntimeSessionDisposalContext,
    StartRuntimeRequest,
    TemporaryDirectoryHandle
} from '../resources/resources.entry-point.ts';
export type {
    TestBodyDirectResourceAttachmentSummary,
    TestBodyExecutionRequirementSummary,
    TestBodyResourceAttachments,
    TestBodyResourceSummary,
    TestBodyRuntimeSummary
} from '../engine/engine.entry-point.ts';

type TestBodyWithScope<Scope extends TestScope> = (scope: Scope) => ReturnType<TestBody>;

export type RuntimeTestScope<
    Graph extends RuntimeGraph,
    Scope extends TestScope = TestScope
> = Scope & {
    readonly runtimes: RuntimeScopeContext<Graph>;
};

export type RuntimeTestBody<
    Graph extends RuntimeGraph,
    Scope extends TestScope = TestScope
> = (scope: RuntimeTestScope<Graph, Scope>) => ReturnType<TestBody>;

export type ResourceScopeContext<Resources extends ResourceMap> = ResourceContext<Resources>;

export type ResourceTestScope<
    Resources extends ResourceMap,
    Scope extends TestScope = TestScope
> = Scope & {
    readonly resources: ResourceScopeContext<Resources>;
};

export type ResourceTestBody<
    Resources extends ResourceMap,
    Scope extends TestScope = TestScope
> = (scope: ResourceTestScope<Resources, Scope>) => ReturnType<TestBody>;

export type RuntimeWrappedTestBody<
    Graph extends RuntimeGraph = RuntimeGraph,
    Scope extends TestScope = TestScope
> = Readonly<Record<never, Graph>> & ResourceAttachedTestBody<TestBodyWithScope<Scope>>;

export type ResourceWrappedTestBody<
    Resources extends ResourceMap = ResourceMap,
    Scope extends TestScope = TestScope
> = Readonly<Record<never, Resources>> & ResourceAttachedTestBody<TestBodyWithScope<Scope>>;

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
    Scope extends TestScope = TestScope
>(
    runtimeGraph: Graph,
    body: RuntimeTestBody<Graph, Scope>
): RuntimeWrappedTestBody<Graph, Scope> {
    const runtime = ensureRuntimeGraph(runtimeGraph);

    return attachComposedResourceBody<Scope>(runtimeWrapperStep(runtime), body, 'withRuntime');
}

export function withResource<
    const Resource extends AnyResourceDefinition,
    Scope extends TestScope = TestScope
>(
    resource: Resource,
    body: ResourceTestBody<Record<Resource['name'], Resource>, Scope>
): ResourceWrappedTestBody<Record<Resource['name'], Resource>, Scope> {
    const descriptor = ensureResource(resource, 'withResource');

    return attachComposedResourceBody<Scope>(resourceWrapperStep(descriptor), body, 'withResource');
}

export function withResources<
    const Resources extends ResourceMap,
    Scope extends TestScope = TestScope
>(
    resources: Resources,
    body: ResourceTestBody<Resources, Scope>
): ResourceWrappedTestBody<Resources, Scope> {
    readResources(resources);

    return attachComposedResourceBody<Scope>(resourcesWrapperStep(resources), body, 'withResources');
}
