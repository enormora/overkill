import {
    assertPerCaseResourceGraph
} from './resource-graph.ts';
import {
    resourceLifecycleError
} from './resource-lifecycle-error.ts';
import {
    acquireResourceGraph,
    disposeResources,
    runtimeAsyncDisposeSymbol
} from './resource-session.ts';
import type {
    AnyResourceDefinition,
    ResourceContext,
    ResourceDependencies,
    RuntimeContext,
    RuntimeDefinition
} from './resources.ts';

type Mutable<Value> = {
    -readonly [Key in keyof Value]: Value[Key];
};

type LifecycleMessages = {
    readonly acquisitionFailure: string;
    readonly disposalFailure: string;
};

export type StartComposedResourceSessionRequest<DirectResources extends ResourceDependencies> = {
    readonly directResources: DirectResources;
    readonly lifecycleMessages: LifecycleMessages;
    readonly runtimes: readonly RuntimeDefinition[];
    readonly signal: AbortSignal;
};

export type ComposedResourceSession<DirectResources extends ResourceDependencies> = AsyncDisposable & {
    readonly directResources: ResourceContext<DirectResources>;
    readonly disposeOnce: (context: DisposalContext) => Promise<void>;
    readonly runtimeContexts: ReadonlyMap<RuntimeDefinition, RuntimeContext<RuntimeDefinition>>;
};

type DisposalContext = {
    readonly signal: AbortSignal;
};

type ComposedResourceSessionBase<DirectResources extends ResourceDependencies> = {
    readonly directResources: ResourceContext<DirectResources>;
    readonly disposeOnce: (context: DisposalContext) => Promise<void>;
    readonly runtimeContexts: ReadonlyMap<RuntimeDefinition, RuntimeContext<RuntimeDefinition>>;
};

function combinedResourceKey(prefix: string, parts: readonly string[]): string {
    return `${prefix}:${parts.join(':')}`;
}

function combinedResourceEntries<DirectResources extends ResourceDependencies>(
    request: StartComposedResourceSessionRequest<DirectResources>
): ResourceDependencies {
    const resources: Mutable<Record<string, AnyResourceDefinition>> = {};

    for (const [ key, resource ] of Object.entries(request.directResources)) {
        resources[combinedResourceKey('resource', [ key ])] = resource;
    }

    for (const runtime of request.runtimes) {
        for (const [ key, resource ] of Object.entries(runtime.resources)) {
            resources[combinedResourceKey('runtime', [ runtime.name, key ])] = resource;
        }
    }

    return Object.freeze(resources);
}

function isResourceContext<Resources extends ResourceDependencies>(
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

function isRuntimeContext<Runtime extends RuntimeDefinition>(
    context: Readonly<Record<string, unknown>>,
    runtime: Runtime
): context is RuntimeContext<Runtime> {
    return isResourceContext(context, runtime.resources);
}

function directResourceContext<DirectResources extends ResourceDependencies>(
    resources: DirectResources,
    handles: ReadonlyMap<AnyResourceDefinition, unknown>
): ResourceContext<DirectResources> {
    const context: Mutable<Record<string, unknown>> = {};

    for (const [ key, resource ] of Object.entries(resources)) {
        context[key] = handles.get(resource);
    }

    const frozenContext = Object.freeze(context);

    if (isResourceContext(frozenContext, resources)) {
        return frozenContext;
    }

    throw resourceLifecycleError('Resource context is incomplete.', [
        { cause: resources, phase: 'graph', resourceName: 'resource' }
    ], resources);
}

function runtimeContext<Runtime extends RuntimeDefinition>(
    runtime: Runtime,
    handles: ReadonlyMap<AnyResourceDefinition, unknown>
): RuntimeContext<Runtime> {
    const context: Mutable<Record<string, unknown>> = {};

    for (const [ key, resource ] of Object.entries(runtime.resources)) {
        context[key] = handles.get(resource);
    }

    const frozenContext = Object.freeze(context);

    if (isRuntimeContext(frozenContext, runtime)) {
        return frozenContext;
    }

    throw resourceLifecycleError('Runtime resource context is incomplete.', [
        { cause: runtime.resources, phase: 'graph', resourceName: 'runtime' }
    ], runtime.resources);
}

function runtimeContexts(
    runtimes: readonly RuntimeDefinition[],
    handles: ReadonlyMap<AnyResourceDefinition, unknown>
): ReadonlyMap<RuntimeDefinition, RuntimeContext<RuntimeDefinition>> {
    return new Map(runtimes.map(function toRuntimeContext(runtime) {
        return [ runtime, runtimeContext(runtime, handles) ];
    }));
}

function internalDisposalSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

function isComposedResourceSession<DirectResources extends ResourceDependencies>(
    session: ComposedResourceSessionBase<DirectResources>
): session is ComposedResourceSession<DirectResources> {
    return Reflect.has(session, runtimeAsyncDisposeSymbol());
}

async function disposeComposedResourceSession(
    acquisition: Awaited<ReturnType<typeof acquireResourceGraph>>,
    signal: AbortSignal,
    disposalFailureMessage: string
): Promise<void> {
    const failures = await disposeResources(acquisition.order, acquisition.handles, signal);

    if (failures.length > 0) {
        throw resourceLifecycleError(disposalFailureMessage, failures, failures[0]?.cause);
    }
}

export async function startComposedResourceSession<DirectResources extends ResourceDependencies>(
    request: StartComposedResourceSessionRequest<DirectResources>
): Promise<ComposedResourceSession<DirectResources>> {
    const resources = combinedResourceEntries(request);

    assertPerCaseResourceGraph(resources);

    const acquisition = await acquireResourceGraph({
        resources,
        signal: request.signal
    }, {
        acquisitionFailureMessage: request.lifecycleMessages.acquisitionFailure,
        fallbackResourceName: 'resource'
    });
    let disposal: Promise<void> | null = null;
    const session = {
        directResources: directResourceContext(request.directResources, acquisition.handles),
        runtimeContexts: runtimeContexts(request.runtimes, acquisition.handles),
        async disposeOnce(context: DisposalContext): Promise<void> {
            if (disposal === null) {
                disposal = disposeComposedResourceSession(
                    acquisition,
                    context.signal,
                    request.lifecycleMessages.disposalFailure
                );
            }

            await disposal;
        }
    };

    Object.defineProperty(session, runtimeAsyncDisposeSymbol(), {
        value: async function disposeComposedResourcesWithInternalSignal(): Promise<void> {
            await session.disposeOnce({ signal: internalDisposalSignal() });
        }
    });
    const frozenSession = Object.freeze(session);

    if (isComposedResourceSession(frozenSession)) {
        return frozenSession;
    }

    throw resourceLifecycleError('Resource session is incomplete.', [
        { cause: session, phase: 'graph', resourceName: 'resource' }
    ], session);
}
