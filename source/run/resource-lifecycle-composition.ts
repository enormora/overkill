import type {
    AnyResourceDefinition,
    ResourceContext,
    RuntimeContext,
    RuntimeDefinition as RuntimeGraph,
    RuntimeResourceMap as ResourceMap
} from '../resources/resources.ts';
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

export type ComposedResourceSession = {
    readonly directResources: ResourceContext<ResourceMap>;
    readonly disposeOnce: (context: DisposalContext) => Promise<void>;
    readonly runtimeContexts: ReadonlyMap<RuntimeGraph, RuntimeContext<RuntimeGraph>>;
};

export type ResourceEntry = {
    readonly key: string;
    readonly resource: AnyResourceDefinition;
};

function entries(record: Readonly<Record<string, AnyResourceDefinition>>): readonly [string, AnyResourceDefinition][] {
    return Object.entries(record);
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
): context is RuntimeContext<Graph> {
    return isResourceContext(context, runtime.resources);
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
): RuntimeContext<Graph> {
    const context = session.runtimeContexts.get(runtime);

    if (context === undefined || !isRuntimeContext(context, runtime)) {
        throw resourceWrapperLifecycleError('Runtime scope composition failed.', runtime);
    }

    return context;
}

function combinedResourceKey(prefix: string, parts: readonly string[]): string {
    return `${prefix}:${parts.join(':')}`;
}

export function combinedResourceEntries(steps: readonly ResourceWrapperStep[]): ResourceMap {
    const resources: Mutable<Record<string, AnyResourceDefinition>> = {};

    for (const entry of directResourceEntries(steps)) {
        resources[combinedResourceKey('resource', [ entry.key ])] = entry.resource;
    }

    for (const runtime of stepRuntimeGraphs(steps)) {
        for (const [ key, resource ] of entries(runtime.resources)) {
            resources[combinedResourceKey('runtime', [ runtime.name, key ])] = resource;
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
    runtimes: readonly RuntimeGraph[],
    session: ResourceSession<ResourceMap>
): ReadonlyMap<RuntimeGraph, RuntimeContext<RuntimeGraph>> {
    return new Map(runtimes.map(function toRuntimeContext(runtime) {
        const context: Mutable<Record<string, unknown>> = {};

        for (const key of Object.keys(runtime.resources)) {
            context[key] = Reflect.get(
                session.context,
                combinedResourceKey('runtime', [ runtime.name, key ])
            );
        }

        return [ runtime, Object.freeze(context) ];
    }));
}

export function composedResourceSession(
    directResources: ResourceMap,
    runtimes: readonly RuntimeGraph[],
    session: ResourceSession<ResourceMap>
): ComposedResourceSession {
    return Object.freeze({
        directResources: directResourceContext(directResources, session),
        disposeOnce: session.disposeOnce,
        runtimeContexts: runtimeContexts(runtimes, session)
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
