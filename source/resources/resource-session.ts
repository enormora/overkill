import type {
    AnyResourceDefinition,
    Awaitable,
    ResourceContext,
    ResourceCreationContext,
    ResourceDependencies,
    ResourceDisposalContext
} from './resources.ts';
import {
    callableResourceDefinition,
    createResourceGraph,
    resourceEntries,
    type ResourceDisposeCallback,
    type ResourceGraph,
    type ResourceNode
} from './resource-graph.ts';
import {
    lifecycleFailures,
    resourceLifecycleError,
    type ResourceLifecycleFailure
} from './resource-lifecycle-error.ts';

type Mutable<Value> = {
    -readonly [Key in keyof Value]: Value[Key];
};

type ResourceAcquisitionResult = {
    readonly handles: ReadonlyMap<AnyResourceDefinition, unknown>;
};
type ResourceAcquisitionContext = {
    readonly acquisitionFailureMessage: string;
    readonly fallbackResourceName: string;
};
type ResourceAcquisition = {
    readonly acquire: (graph: ResourceGraph) => Promise<ResourceAcquisitionResult>;
    readonly dependencies: (dependencies: ResourceDependencies) => Promise<ResourceContext<ResourceDependencies>>;
    readonly failStartup: (graph: ResourceGraph, failures: readonly ResourceLifecycleFailure[]) => Promise<never>;
    readonly resource: (resource: AnyResourceDefinition) => Promise<unknown>;
    readonly start: (resource: AnyResourceDefinition) => Promise<unknown>;
};
type ResourceSessionBase<Resources extends ResourceDependencies> = {
    readonly context: ResourceContext<Resources>;
    readonly disposeOnce: (context: ResourceSessionDisposalContext) => Promise<void>;
};
const directResourceAcquisitionContext: ResourceAcquisitionContext = {
    acquisitionFailureMessage: 'Resource acquisition failed.',
    fallbackResourceName: 'resource'
};

export type StartResourcesRequest<Resources extends ResourceDependencies> = {
    readonly resources: Resources;
    readonly signal: AbortSignal;
};

export type ResourceSessionDisposalContext = {
    readonly signal: AbortSignal;
};

export type ResourceSession<Resources extends ResourceDependencies> = AsyncDisposable & {
    readonly context: ResourceContext<Resources>;
    readonly disposeOnce: (context: ResourceSessionDisposalContext) => Promise<void>;
};

function acquiredDependencyHandles(
    dependencies: ResourceDependencies,
    handles: ReadonlyMap<AnyResourceDefinition, unknown>
): ResourceContext<ResourceDependencies> {
    const context: Mutable<Record<string, unknown>> = {};

    for (const [ key, resource ] of resourceEntries(dependencies)) {
        context[key] = handles.get(resource);
    }

    return Object.freeze(context);
}

function acquireResourceHandle(
    resource: AnyResourceDefinition,
    context: ResourceCreationContext<ResourceDependencies>
): Awaitable<unknown> {
    return callableResourceDefinition(resource).acquire(context);
}

function disposeResourceHandle(
    dispose: ResourceDisposeCallback,
    handle: unknown,
    context: ResourceDisposalContext<ResourceDependencies>
): Awaitable<void> {
    return dispose(handle, context);
}

async function disposeResource(
    node: ResourceNode,
    handles: ReadonlyMap<AnyResourceDefinition, unknown>,
    signal: AbortSignal
): Promise<ResourceLifecycleFailure | null> {
    const handle = handles.get(node.descriptor);
    const { dispose } = callableResourceDefinition(node.descriptor);

    if (handle === undefined || dispose === null) {
        return null;
    }

    try {
        await disposeResourceHandle(dispose, handle, {
            dependencies: acquiredDependencyHandles(node.descriptor.dependencies, handles),
            signal
        });

        return null;
    } catch (error: unknown) {
        return { cause: error, phase: 'dispose', resourceName: node.descriptor.name };
    }
}

export async function disposeResources(
    order: readonly ResourceNode[],
    handles: ReadonlyMap<AnyResourceDefinition, unknown>,
    signal: AbortSignal
): Promise<readonly ResourceLifecycleFailure[]> {
    const failures: ResourceLifecycleFailure[] = [];

    for (const node of order.toReversed()) {
        const failure = await disposeResource(node, handles, signal);

        if (failure !== null) {
            failures.push(failure);
        }
    }

    return failures;
}

async function disposeResourceSession(
    order: readonly ResourceNode[],
    handles: ReadonlyMap<AnyResourceDefinition, unknown>,
    signal: AbortSignal
): Promise<void> {
    const failures = await disposeResources(order, handles, signal);

    if (failures.length > 0) {
        throw resourceLifecycleError('Resource disposal failed.', failures, failures[0]?.cause);
    }
}

function createResourceAcquisition(
    signal: AbortSignal,
    acquisitionContext: ResourceAcquisitionContext
): ResourceAcquisition {
    const abortController = new AbortController();
    const acquisitionSignal = AbortSignal.any([ signal, abortController.signal ]);
    const acquisitions = new Map<AnyResourceDefinition, Promise<unknown>>();
    const handles = new Map<AnyResourceDefinition, unknown>();
    const acquisition: ResourceAcquisition = {
        async acquire(graph) {
            const results = await Promise.allSettled(
                graph.topLevelEntries.map(async function acquireTopLevel([ , resource ]) {
                    return await acquisition.resource(resource);
                })
            );
            const failures = lifecycleFailures(results, acquisitionContext.fallbackResourceName);

            if (failures.length > 0) {
                return await acquisition.failStartup(graph, failures);
            }

            return { handles };
        },
        async dependencies(dependencies) {
            const context: Mutable<Record<string, unknown>> = {};

            await Promise.all(
                resourceEntries(dependencies).map(async function acquireDependency([ key, dependency ]) {
                    context[key] = await acquisition.resource(dependency);
                })
            );

            return Object.freeze(context);
        },
        async failStartup(graph, failures) {
            abortController.abort(failures[0]?.cause);

            const disposalFailures = await disposeResources(graph.order, handles, signal);

            throw resourceLifecycleError(acquisitionContext.acquisitionFailureMessage, [
                ...failures,
                ...disposalFailures
            ], failures[0]?.cause);
        },
        async resource(resource) {
            const existingAcquisition = acquisitions.get(resource);

            if (existingAcquisition !== undefined) {
                return await existingAcquisition;
            }

            const resourceAcquisition = acquisition.start(resource);

            acquisitions.set(resource, resourceAcquisition);

            return await resourceAcquisition;
        },
        async start(resource) {
            const dependencies = await acquisition.dependencies(resource.dependencies);

            try {
                const handle = await acquireResourceHandle(resource, {
                    dependencies,
                    signal: acquisitionSignal
                });

                handles.set(resource, handle);

                return handle;
            } catch (error: unknown) {
                abortController.abort(error);
                throw resourceLifecycleError(`Resource "${resource.name}" acquisition failed.`, [
                    { cause: error, phase: 'acquire', resourceName: resource.name }
                ], error);
            }
        }
    };

    return acquisition;
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

function resourceContext<Resources extends ResourceDependencies>(
    resources: Resources,
    handles: ReadonlyMap<AnyResourceDefinition, unknown>
): ResourceContext<Resources> {
    const context: Record<string, unknown> = {};

    for (const [ key, resource ] of resourceEntries(resources)) {
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

function internalDisposalSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

export function runtimeAsyncDisposeSymbol(): symbol {
    const value = Reflect.get(Symbol, 'asyncDispose');

    if (typeof value !== 'symbol') {
        throw new TypeError('Runtime does not provide Symbol.asyncDispose.');
    }

    return value;
}

function isResourceSession<Resources extends ResourceDependencies>(
    session: ResourceSessionBase<Resources>
): session is ResourceSession<Resources> {
    return Reflect.has(session, runtimeAsyncDisposeSymbol());
}

export async function acquireResourceGraph<Resources extends ResourceDependencies>(
    request: StartResourcesRequest<Resources>,
    context: ResourceAcquisitionContext
): Promise<{
    readonly context: ResourceContext<Resources>;
    readonly handles: ReadonlyMap<AnyResourceDefinition, unknown>;
    readonly order: readonly ResourceNode[];
}> {
    const graph = createResourceGraph(request.resources);
    const acquisition = await createResourceAcquisition(request.signal, context).acquire(graph);

    return {
        context: resourceContext(request.resources, acquisition.handles),
        handles: acquisition.handles,
        order: graph.order
    };
}

export async function startResources<Resources extends ResourceDependencies>(
    request: StartResourcesRequest<Resources>
): Promise<ResourceSession<Resources>> {
    const acquisition = await acquireResourceGraph(request, directResourceAcquisitionContext);
    let disposal: Promise<void> | null = null;
    const session = {
        context: acquisition.context,
        async disposeOnce(disposalContext: ResourceSessionDisposalContext): Promise<void> {
            if (disposal === null) {
                disposal = disposeResourceSession(acquisition.order, acquisition.handles, disposalContext.signal);
            }

            await disposal;
        }
    };

    Object.defineProperty(session, runtimeAsyncDisposeSymbol(), {
        value: async function disposeResourcesWithInternalSignal(): Promise<void> {
            await session.disposeOnce({ signal: internalDisposalSignal() });
        }
    });
    const frozenSession = Object.freeze(session);

    if (isResourceSession(frozenSession)) {
        return frozenSession;
    }

    throw resourceLifecycleError('Resource session is incomplete.', [
        { cause: session, phase: 'graph', resourceName: 'resource' }
    ], session);
}
