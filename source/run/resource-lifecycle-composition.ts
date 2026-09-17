import type {
    AnyResourceDefinition,
    ResourceContext,
    RuntimeGraph,
    RuntimeGraphContext,
    RuntimeId,
    RuntimeDefinition,
    RuntimeResourceMap as ResourceMap
} from '../resources/resources.ts';
import { runtimeIdentityKey, type WorkId } from '../engine/identity.ts';
import type { ResourceSession } from '../resources/resource-session.ts';
import { resourceWrapperLifecycleError } from './resource-lifecycle-error.ts';

type Mutable<Value> = {
    -readonly [Key in keyof Value]: Value[Key];
};

type DisposalContext = {
    readonly signal: AbortSignal;
};

export type LifecycleMessages = {
    readonly acquisitionFailure: string;
    readonly disposalFailure: string;
};

type ResourceWrapperResourcesStep = {
    readonly kind: 'resources';
    readonly resources: ResourceMap;
};

type ResourceWrapperRuntimeStep = {
    readonly kind: 'runtime';
    readonly runtime: RuntimeGraph;
};

export type ResourceWrapperStep = ResourceWrapperResourcesStep | ResourceWrapperRuntimeStep;

type ResolvedRuntimeGraph = {
    readonly id: RuntimeId;
    readonly graph: RuntimeGraph;
    readonly runtime: RuntimeDefinition;
};

export type ComposedResourceSession = {
    readonly directResources: ResourceContext<ResourceMap>;
    readonly disposeOnce: (context: DisposalContext) => Promise<void>;
    readonly runtimeContexts: ReadonlyMap<RuntimeGraph, RuntimeGraphContext<RuntimeGraph>>;
};

export type ResourceEntry = {
    readonly key: string;
    readonly resource: AnyResourceDefinition;
};

function entries(record: Readonly<Record<string, AnyResourceDefinition>>): readonly [string, AnyResourceDefinition][] {
    return Object.entries(record);
}

function runtimeId(graph: RuntimeGraph, runtime: RuntimeDefinition, variantId: string | null): RuntimeId {
    return {
        dimensions: runtime.dimensions,
        name: graph.name,
        variantId
    };
}

type RuntimeMatrixGraph = Extract<RuntimeGraph, { readonly kind: 'runtime-matrix'; }>;
type RuntimeMatrixVariantValue = RuntimeMatrixGraph['variants'][string];
type MatrixWorkId = WorkId & { readonly runtime: RuntimeId; };

function assertMatrixWork(runtime: RuntimeMatrixGraph, workId: WorkId | null): MatrixWorkId {
    const selectedRuntime = workId?.runtime ?? null;

    if (workId === null || selectedRuntime === null) {
        throw resourceWrapperLifecycleError(
            `Runtime matrix "${runtime.name}" requires runner-managed execution.`,
            runtime
        );
    }

    return { ...workId, runtime: selectedRuntime };
}

function selectedMatrixVariant(runtime: RuntimeMatrixGraph, workId: WorkId | null): RuntimeMatrixVariantValue {
    const selectedWork = assertMatrixWork(runtime, workId);

    if (selectedWork.runtime.name !== runtime.name || selectedWork.runtime.variantId === null) {
        throw resourceWrapperLifecycleError(
            `Runtime matrix "${runtime.name}" has no selected variant for this work item.`,
            selectedWork
        );
    }

    const variant = runtime.variants[selectedWork.runtime.variantId];

    if (variant === undefined) {
        throw resourceWrapperLifecycleError(
            `Runtime matrix "${runtime.name}" has no variant "${selectedWork.runtime.variantId}".`,
            selectedWork
        );
    }

    return variant;
}

function resolveRuntimeGraph(runtime: RuntimeGraph, workId: WorkId | null): ResolvedRuntimeGraph {
    if (runtime.kind !== 'runtime-matrix') {
        return {
            graph: runtime,
            id: runtime.id,
            runtime
        };
    }

    const variant = selectedMatrixVariant(runtime, workId);

    return {
        graph: runtime,
        id: runtimeId(runtime, variant.runtime, variant.id),
        runtime: variant.runtime
    };
}

function resolvedRuntimeGraphs(
    steps: readonly ResourceWrapperStep[],
    workId: WorkId | null
): readonly ResolvedRuntimeGraph[] {
    return steps.flatMap(function stepRuntimeGraph(step) {
        return step.kind === 'runtime' ? [ resolveRuntimeGraph(step.runtime, workId) ] : [];
    });
}

export function directResourceEntries(steps: readonly ResourceWrapperStep[]): readonly ResourceEntry[] {
    return steps.flatMap(function stepResourceEntries(step) {
        return step.kind === 'resources'
            ? entries(step.resources).map(function resourceEntry([ key, resource ]) {
                return { key, resource };
            })
            : [];
    });
}

export function stepRuntimeGraphs(steps: readonly ResourceWrapperStep[]): readonly RuntimeGraph[] {
    return steps.flatMap(function stepRuntimeGraph(step) {
        return step.kind === 'runtime' ? [ step.runtime ] : [];
    });
}

export function resourceMapFromEntries(resourceEntries: readonly ResourceEntry[]): ResourceMap {
    const resources: Mutable<Record<string, AnyResourceDefinition>> = {};

    for (const entry of resourceEntries) {
        resources[entry.key] = entry.resource;
    }

    return Object.freeze(resources);
}

function isResourceContext<Resources extends ResourceMap>(
    context: Readonly<Record<string, unknown>>,
    resources: Resources
): context is ResourceContext<Resources> {
    for (const key of Object.keys(resources)) {
        if (!Object.hasOwn(context, key)) {
            return false;
        }
    }

    return true;
}

function isRuntimeContext<Graph extends RuntimeGraph>(
    context: Readonly<Record<string, unknown>>,
    runtime: Graph
): context is RuntimeGraphContext<Graph> {
    if (runtime.kind === 'runtime') {
        return isResourceContext(context, runtime.resources);
    }

    return true;
}

export function resourceContextForStep<Resources extends ResourceMap>(
    resources: Resources,
    handles: ResourceContext<ResourceMap>
): ResourceContext<Resources> {
    const context: Mutable<Record<string, unknown>> = {};

    for (const key of Object.keys(resources)) {
        context[key] = Reflect.get(handles, key);
    }

    const frozenContext = Object.freeze(context);

    if (isResourceContext(frozenContext, resources)) {
        return frozenContext;
    }

    throw resourceWrapperLifecycleError('Resource scope composition failed.', resources);
}

export function runtimeContextForStep<Graph extends RuntimeGraph>(
    runtime: Graph,
    session: ComposedResourceSession
): RuntimeGraphContext<Graph> {
    const context = session.runtimeContexts.get(runtime);

    if (context === undefined || !isRuntimeContext(context, runtime)) {
        throw resourceWrapperLifecycleError('Runtime scope composition failed.', runtime);
    }

    return context;
}

function combinedResourceKey(prefix: string, parts: readonly string[]): string {
    return `${prefix}:${parts.join(':')}`;
}

const scopedRuntimeResources = new WeakMap<AnyResourceDefinition, Map<string, AnyResourceDefinition>>();

function cacheScopedRuntimeResource(
    resource: AnyResourceDefinition,
    runtimeKey: string,
    scoped: AnyResourceDefinition,
    cachedResources: ReadonlyMap<string, AnyResourceDefinition>
): void {
    scopedRuntimeResources.set(resource, new Map([ ...cachedResources, [ runtimeKey, scoped ] ]));
}

function scopedRuntimeResource(
    resource: AnyResourceDefinition,
    runtimeKey: string
): AnyResourceDefinition {
    const cachedResources = scopedRuntimeResources.get(resource) ?? new Map<string, AnyResourceDefinition>();
    const cached = cachedResources.get(runtimeKey);

    if (cached !== undefined) {
        return cached;
    }

    const dependencies: Mutable<Record<string, AnyResourceDefinition>> = {};

    for (const [ key, dependency ] of entries(resource.dependencies)) {
        dependencies[key] = scopedRuntimeResource(dependency, runtimeKey);
    }

    const scoped = Object.freeze({
        ...resource,
        dependencies: Object.freeze(dependencies),
        name: `${resource.name}@${runtimeKey}`
    });

    cacheScopedRuntimeResource(resource, runtimeKey, scoped, cachedResources);

    return scoped;
}

export function combinedResourceEntries(
    steps: readonly ResourceWrapperStep[],
    workId: WorkId | null = null
): ResourceMap {
    const resources: Mutable<Record<string, AnyResourceDefinition>> = {};

    for (const entry of directResourceEntries(steps)) {
        resources[combinedResourceKey('resource', [ entry.key ])] = entry.resource;
    }

    for (const runtime of resolvedRuntimeGraphs(steps, workId)) {
        const runtimeKey = runtimeIdentityKey(runtime.id);

        for (const [ key, resource ] of entries(runtime.runtime.resources)) {
            resources[combinedResourceKey('runtime', [ runtimeKey, key ])] = scopedRuntimeResource(
                resource,
                runtimeKey
            );
        }
    }

    return Object.freeze(resources);
}

function directResourceContext(
    directResources: ResourceMap,
    session: ResourceSession<ResourceMap>
): ResourceContext<ResourceMap> {
    const context: Mutable<Record<string, unknown>> = {};

    for (const key of Object.keys(directResources)) {
        context[key] = Reflect.get(
            session.context,
            combinedResourceKey('resource', [ key ])
        );
    }

    return Object.freeze(context);
}

function runtimeContexts(
    runtimes: readonly ResolvedRuntimeGraph[],
    session: ResourceSession<ResourceMap>
): ReadonlyMap<RuntimeGraph, RuntimeGraphContext<RuntimeGraph>> {
    return new Map(runtimes.map(function toRuntimeContext(runtime) {
        const context: Mutable<Record<string, unknown>> = {};
        const runtimeKey = runtimeIdentityKey(runtime.id);

        for (const key of Object.keys(runtime.runtime.resources)) {
            context[key] = Reflect.get(
                session.context,
                combinedResourceKey('runtime', [ runtimeKey, key ])
            );
        }

        return [ runtime.graph, Object.freeze(context) ];
    }));
}

export function composedResourceSession(
    directResources: ResourceMap,
    runtimes: readonly RuntimeGraph[],
    session: ResourceSession<ResourceMap>,
    workId: WorkId | null = null
): ComposedResourceSession {
    return Object.freeze({
        directResources: directResourceContext(directResources, session),
        disposeOnce: session.disposeOnce,
        runtimeContexts: runtimeContexts(
            runtimes.map(function resolveRuntime(runtime) {
                return resolveRuntimeGraph(runtime, workId);
            }),
            session
        )
    });
}

export function lifecycleMessages(steps: readonly ResourceWrapperStep[]): LifecycleMessages {
    const hasDirectResources = steps.some(function stepHasDirectResources(step) {
        return step.kind === 'resources';
    });

    return hasDirectResources
        ? {
            acquisitionFailure: 'Resource acquisition failed.',
            disposalFailure: 'Resource disposal failed.'
        }
        : {
            acquisitionFailure: 'Runtime resource acquisition failed.',
            disposalFailure: 'Runtime resource disposal failed.'
        };
}
