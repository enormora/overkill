import {
    type AnyResourceDefinition,
    type Awaitable,
    isDefinedResource,
    isDefinedRuntime,
    type ResourceContext,
    type ResourceCreationContext,
    type ResourceDependencies,
    type ResourceDisposalContext,
    type RuntimeContext,
    type RuntimeDefinition,
    type RuntimeResourceMap
} from './resources.ts';

type Mutable<Value> = {
    -readonly [Key in keyof Value]: Value[Key];
};

type ResourceEntry = readonly [string, AnyResourceDefinition];
type ResourceNode = {
    readonly dependencies: readonly ResourceNode[];
    readonly descriptor: AnyResourceDefinition;
};
type ResourceGraph = {
    readonly order: readonly ResourceNode[];
    readonly topLevelEntries: readonly ResourceEntry[];
};
type ResourceAcquisitionResult = {
    readonly handles: ReadonlyMap<AnyResourceDefinition, unknown>;
};
type ResourceGraphBuilder = {
    readonly build: (runtime: RuntimeDefinition) => ResourceGraph;
};
type ResourceGraphController = ResourceGraphBuilder & {
    readonly assertAcyclic: (resource: AnyResourceDefinition, path: readonly string[]) => void;
    readonly assertUniqueName: (resource: AnyResourceDefinition) => void;
    readonly record: (resource: AnyResourceDefinition, path: readonly string[]) => ResourceNode;
    readonly visit: (resource: AnyResourceDefinition, path: readonly string[]) => ResourceNode;
};
type RuntimeResourceAcquisition = {
    readonly acquire: (graph: ResourceGraph) => Promise<ResourceAcquisitionResult>;
    readonly dependencies: (dependencies: ResourceDependencies) => Promise<ResourceContext<ResourceDependencies>>;
    readonly failStartup: (
        graph: ResourceGraph,
        failures: readonly ResourceLifecycleFailure[]
    ) => Promise<never>;
    readonly resource: (resource: AnyResourceDefinition) => Promise<unknown>;
    readonly start: (resource: AnyResourceDefinition) => Promise<unknown>;
};
type RuntimeSessionDisposal = {
    readonly disposeOnce: (context: RuntimeSessionDisposalContext) => Promise<void>;
};
type RuntimeSessionBase<Runtime extends RuntimeDefinition> = {
    readonly context: RuntimeContext<Runtime>;
    readonly disposeOnce: (context: RuntimeSessionDisposalContext) => Promise<void>;
};
type ResourceLifecycleErrorOptions = {
    readonly cause: unknown;
    readonly failures: readonly ResourceLifecycleFailure[];
};
type DependencyDisposalContext = ResourceDisposalContext<ResourceDependencies>;
type ResourceDisposeCallback = (handle: unknown, context: DependencyDisposalContext) => Awaitable<void>;
type CallableResourceDefinition = AnyResourceDefinition & {
    readonly acquire: (context: ResourceCreationContext<ResourceDependencies>) => Awaitable<unknown>;
    readonly dispose: ResourceDisposeCallback | null;
};

export type StartRuntimeRequest<Runtime extends RuntimeDefinition> = {
    readonly runtime: Runtime;
    readonly signal: AbortSignal;
};

export type RuntimeSessionDisposalContext = {
    readonly signal: AbortSignal;
};

export type RuntimeSession<Runtime extends RuntimeDefinition> = AsyncDisposable & {
    readonly context: RuntimeContext<Runtime>;
    readonly disposeOnce: (context: RuntimeSessionDisposalContext) => Promise<void>;
};

export type ResourceLifecyclePhase = 'acquire' | 'dispose' | 'graph';

export type ResourceLifecycleFailure = {
    readonly cause: unknown;
    readonly phase: ResourceLifecyclePhase;
    readonly resourceName: string;
};

export class ResourceLifecycleError extends Error {
    private readonly lifecycleFailures: readonly ResourceLifecycleFailure[];

    public constructor(
        message: string,
        options: ResourceLifecycleErrorOptions
    ) {
        super(message, options);
        this.name = 'ResourceLifecycleError';
        this.lifecycleFailures = options.failures;
    }

    public failures(): readonly ResourceLifecycleFailure[] {
        return this.lifecycleFailures;
    }
}

function resourceLifecycleError(
    message: string,
    failures: readonly ResourceLifecycleFailure[],
    cause: unknown
): ResourceLifecycleError {
    return new ResourceLifecycleError(message, { cause, failures });
}

function assertRuntimeDefinition(runtime: RuntimeDefinition): void {
    if (isDefinedRuntime(runtime)) {
        return;
    }

    throw resourceLifecycleError('Runtime descriptor is invalid.', [
        { cause: runtime, phase: 'graph', resourceName: 'runtime' }
    ], runtime);
}

function hasCallableResourceCallbacks(resource: AnyResourceDefinition): resource is CallableResourceDefinition {
    return isDefinedResource(resource) && typeof resource.acquire === 'function';
}

function callableResourceDefinition(resource: AnyResourceDefinition): CallableResourceDefinition {
    if (hasCallableResourceCallbacks(resource)) {
        return resource;
    }

    throw resourceLifecycleError('Resource descriptor is invalid.', [
        { cause: resource, phase: 'graph', resourceName: 'resource' }
    ], resource);
}

function resourceEntries(resources: ResourceDependencies): readonly ResourceEntry[] {
    return Object.entries(resources);
}

function lifecycleFailuresFrom(reason: unknown): readonly ResourceLifecycleFailure[] {
    if (reason instanceof ResourceLifecycleError) {
        return reason.failures();
    }

    return [ { cause: reason, phase: 'acquire', resourceName: 'runtime' } ];
}

function lifecycleFailures(results: readonly PromiseSettledResult<unknown>[]): readonly ResourceLifecycleFailure[] {
    const failures = new Set<ResourceLifecycleFailure>();

    for (const result of results) {
        if (result.status === 'rejected') {
            for (const failure of lifecycleFailuresFrom(result.reason)) {
                failures.add(failure);
            }
        }
    }

    return Array.from(failures);
}

function createResourceGraphBuilder(): ResourceGraphBuilder {
    const descriptorsByName = new Map<string, AnyResourceDefinition>();
    const nodesByDescriptor = new Map<AnyResourceDefinition, ResourceNode>();
    const order: ResourceNode[] = [];
    const traversal = new Set<AnyResourceDefinition>();
    const builder: ResourceGraphController = {
        assertAcyclic(resource, path) {
            if (!traversal.has(resource)) {
                return;
            }

            throw resourceLifecycleError(`Resource dependency cycle detected: ${path.join(' -> ')}.`, [
                { cause: resource, phase: 'graph', resourceName: resource.name }
            ], resource);
        },
        assertUniqueName(resource) {
            const descriptorForName = descriptorsByName.get(resource.name);

            if (descriptorForName !== undefined && descriptorForName !== resource) {
                throw resourceLifecycleError(`Resource name "${resource.name}" is used by multiple descriptors.`, [
                    { cause: resource, phase: 'graph', resourceName: resource.name }
                ], resource);
            }

            descriptorsByName.set(resource.name, resource);
        },
        build(runtime) {
            assertRuntimeDefinition(runtime);

            const topLevelEntries = resourceEntries(runtime.resources);

            for (const [ , resource ] of topLevelEntries) {
                builder.visit(resource, [ resource.name ]);
            }

            return { order, topLevelEntries };
        },
        record(resource, path) {
            traversal.add(resource);

            const dependencies = resourceEntries(resource.dependencies).map(function visitDependency([ , dependency ]) {
                return builder.visit(dependency, [ ...path, dependency.name ]);
            });
            const node = { dependencies, descriptor: resource };

            traversal.delete(resource);
            nodesByDescriptor.set(resource, node);
            order.push(node);

            return node;
        },
        visit(resource, path) {
            const callableResource = callableResourceDefinition(resource);

            builder.assertUniqueName(callableResource);
            builder.assertAcyclic(callableResource, path);

            const existingNode = nodesByDescriptor.get(callableResource);

            if (existingNode !== undefined) {
                return existingNode;
            }

            return builder.record(callableResource, path);
        }
    };

    return builder;
}

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
    resource: AnyResourceDefinition,
    handle: unknown,
    context: ResourceDisposalContext<ResourceDependencies>
): Awaitable<void> {
    const { dispose } = callableResourceDefinition(resource);

    if (dispose === null) {
        return undefined;
    }

    return dispose(handle, context);
}

async function disposeResource(
    node: ResourceNode,
    handles: ReadonlyMap<AnyResourceDefinition, unknown>,
    signal: AbortSignal
): Promise<ResourceLifecycleFailure | null> {
    const handle = handles.get(node.descriptor);

    if (handle === undefined || callableResourceDefinition(node.descriptor).dispose === null) {
        return null;
    }

    try {
        await disposeResourceHandle(node.descriptor, handle, {
            dependencies: acquiredDependencyHandles(node.descriptor.dependencies, handles),
            signal
        });

        return null;
    } catch (error: unknown) {
        return { cause: error, phase: 'dispose', resourceName: node.descriptor.name };
    }
}

async function disposeRuntimeResources(
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

async function disposeRuntimeSession(
    order: readonly ResourceNode[],
    handles: ReadonlyMap<AnyResourceDefinition, unknown>,
    signal: AbortSignal
): Promise<void> {
    const failures = await disposeRuntimeResources(order, handles, signal);

    if (failures.length > 0) {
        throw resourceLifecycleError('Runtime resource disposal failed.', failures, failures[0]?.cause);
    }
}

function createRuntimeResourceAcquisition(signal: AbortSignal): RuntimeResourceAcquisition {
    const abortController = new AbortController();
    const acquisitionSignal = AbortSignal.any([ signal, abortController.signal ]);
    const acquisitions = new Map<AnyResourceDefinition, Promise<unknown>>();
    const handles = new Map<AnyResourceDefinition, unknown>();
    const acquisition: RuntimeResourceAcquisition = {
        async acquire(graph) {
            const results = await Promise.allSettled(
                graph.topLevelEntries.map(async function acquireTopLevel([ , resource ]) {
                    return await acquisition.resource(resource);
                })
            );
            const failures = lifecycleFailures(results);

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

            const disposalFailures = await disposeRuntimeResources(graph.order, handles, signal);

            throw resourceLifecycleError('Runtime resource acquisition failed.', [
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

function isRuntimeContext<Resources extends RuntimeResourceMap>(
    context: Readonly<Record<string, unknown>>,
    resources: Resources
): context is RuntimeContext<RuntimeDefinition<string, Record<string, string>, Resources>> {
    for (const key of Object.keys(resources)) {
        if (!Object.hasOwn(context, key)) {
            return false;
        }
    }

    return true;
}

function runtimeContext<Resources extends RuntimeResourceMap>(
    resources: Resources,
    handles: ReadonlyMap<AnyResourceDefinition, unknown>
): RuntimeContext<RuntimeDefinition<string, Record<string, string>, Resources>> {
    const context: Record<string, unknown> = {};

    for (const [ key, resource ] of resourceEntries(resources)) {
        context[key] = handles.get(resource);
    }

    const frozenContext = Object.freeze(context);

    if (isRuntimeContext(frozenContext, resources)) {
        return frozenContext;
    }

    throw resourceLifecycleError('Runtime resource context is incomplete.', [
        { cause: resources, phase: 'graph', resourceName: 'runtime' }
    ], resources);
}

function runtimeSessionDisposal(
    order: readonly ResourceNode[],
    handles: ReadonlyMap<AnyResourceDefinition, unknown>
): RuntimeSessionDisposal {
    let disposal: Promise<void> | null = null;

    async function disposeOnce(disposalContext: RuntimeSessionDisposalContext): Promise<void> {
        if (disposal === null) {
            disposal = disposeRuntimeSession(order, handles, disposalContext.signal);
        }

        await disposal;
    }

    return { disposeOnce };
}

function internalDisposalSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

function runtimeAsyncDisposeSymbol(): symbol {
    const value = Reflect.get(Symbol, 'asyncDispose');

    if (typeof value !== 'symbol') {
        throw new TypeError('Runtime does not provide Symbol.asyncDispose.');
    }

    return value;
}

function isRuntimeSession<Runtime extends RuntimeDefinition>(
    session: RuntimeSessionBase<Runtime>
): session is RuntimeSession<Runtime> {
    return Reflect.has(session, runtimeAsyncDisposeSymbol());
}

function runtimeSession<Runtime extends RuntimeDefinition>(
    context: RuntimeContext<Runtime>,
    order: readonly ResourceNode[],
    handles: ReadonlyMap<AnyResourceDefinition, unknown>
): RuntimeSession<Runtime> {
    const disposal = runtimeSessionDisposal(order, handles);
    const session = {
        context,
        disposeOnce: disposal.disposeOnce
    };

    Object.defineProperty(session, runtimeAsyncDisposeSymbol(), {
        value: async function disposeRuntimeWithInternalSignal(): Promise<void> {
            await disposal.disposeOnce({ signal: internalDisposalSignal() });
        }
    });
    const frozenSession = Object.freeze(session);

    if (isRuntimeSession(frozenSession)) {
        return frozenSession;
    }

    throw resourceLifecycleError('Runtime session is incomplete.', [
        { cause: session, phase: 'graph', resourceName: 'runtime' }
    ], session);
}

export async function startRuntime<Runtime extends RuntimeDefinition>(
    request: StartRuntimeRequest<Runtime>
): Promise<RuntimeSession<Runtime>> {
    const graphBuilder = createResourceGraphBuilder();
    const resourceAcquisition = createRuntimeResourceAcquisition(request.signal);
    const graph = graphBuilder.build(request.runtime);
    const acquisition = await resourceAcquisition.acquire(graph);
    const context = runtimeContext<Runtime['resources']>(request.runtime.resources, acquisition.handles);

    return runtimeSession<Runtime>(context, graph.order, acquisition.handles);
}
