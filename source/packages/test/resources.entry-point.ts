import {
    attachTestBodyResourceAttachments,
    CaseRunnerError,
    hasTestBodyResourceAttachments,
    type ResourceAttachedTestBody,
    type TestBody,
    type TestBodyDirectResourceAttachmentSummary,
    type TestBodyExecutionRequirementSummary,
    type TestBodyResourceAttachments,
    type TestBodyResourceSummary,
    type TestBodyRuntimeSummary,
    type TestScope
} from '../engine/engine.entry-point.ts';
import {
    isDefinedResource,
    isDefinedRuntime,
    ResourceLifecycleError,
    startRuntime,
    type AnyResourceDefinition,
    type ExecutionRequirement,
    type ResourceContext,
    type ResourceMap,
    type RuntimeContext,
    type RuntimeGraph,
    type RuntimeSession,
    type RuntimeScopeContext
} from '../resources/resources.entry-point.ts';
import {
    assertPerCaseResourceGraph
} from '../../resources/resource-graph.ts';
import {
    startResources,
    type ResourceSession
} from '../../resources/resource-session.ts';

export {
    composeRuntimeContext,
    createTemporaryDirectoryResource,
    defineResource,
    defineRuntime,
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
    ResourceLifecycleFailure,
    ResourceLifecyclePhase,
    ResourceMap,
    ResourceScope,
    RuntimeContext,
    RuntimeContextComposition,
    RuntimeDefinition,
    RuntimeDefinitionInput,
    RuntimeDimensions,
    RuntimeGraph,
    RuntimeId,
    RuntimeResourceMap,
    RuntimeScopeContext,
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
type TestBodyResult = ReturnType<TestBody>;
type AsyncTestBodyResult = Promise<Awaited<TestBodyResult>>;

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

type ResourceGraphCollector = {
    readonly resourceGraph: () => readonly TestBodyResourceSummary[];
    readonly visit: (resource: AnyResourceDefinition, path: readonly string[]) => void;
};

function ensureBody(body: unknown, wrapperName: string): asserts body is TestBody {
    if (typeof body !== 'function') {
        throw new TypeError(`${wrapperName}() requires a body function.`);
    }

    if (hasTestBodyResourceAttachments(body)) {
        throw new TypeError(`${wrapperName}() does not support already wrapped bodies yet.`);
    }
}

function ensureResource(resource: unknown, wrapperName: string): AnyResourceDefinition {
    if (!isDefinedResource(resource)) {
        throw new TypeError(`${wrapperName}() requires resource descriptors.`);
    }

    return resource;
}

function ensureRuntimeGraph(runtimeGraph: unknown): RuntimeGraph {
    if (!isDefinedRuntime(runtimeGraph)) {
        throw new TypeError('withRuntime() requires a runtime descriptor.');
    }

    return runtimeGraph;
}

function entries(record: Readonly<Record<string, AnyResourceDefinition>>): readonly [string, AnyResourceDefinition][] {
    return Object.entries(record);
}

function requirementSummary(requirement: ExecutionRequirement): TestBodyExecutionRequirementSummary {
    return { ...requirement };
}

function resourceSummary(resource: AnyResourceDefinition): TestBodyResourceSummary {
    return {
        dependencies: Object.values(resource.dependencies).map(function dependencyName(dependency) {
            return dependency.name;
        }),
        name: resource.name,
        requirements: resource.requirements.map(requirementSummary),
        scope: resource.scope
    };
}

function assertUniqueResourceName(
    descriptorsByName: ReadonlyMap<string, AnyResourceDefinition>,
    descriptor: AnyResourceDefinition
): void {
    const descriptorForName = descriptorsByName.get(descriptor.name);

    if (descriptorForName !== undefined && descriptorForName !== descriptor) {
        throw new TypeError(`Resource name "${descriptor.name}" is used by multiple descriptors.`);
    }
}

function assertResourceAcyclic(
    traversal: ReadonlySet<AnyResourceDefinition>,
    descriptor: AnyResourceDefinition,
    path: readonly string[]
): void {
    if (traversal.has(descriptor)) {
        throw new TypeError(`Resource dependency cycle detected: ${path.join(' -> ')}.`);
    }
}

function assertResourceCanBeRecorded(
    descriptorsByName: ReadonlyMap<string, AnyResourceDefinition>,
    traversal: ReadonlySet<AnyResourceDefinition>,
    descriptor: AnyResourceDefinition,
    path: readonly string[]
): void {
    assertUniqueResourceName(descriptorsByName, descriptor);
    assertResourceAcyclic(traversal, descriptor, path);
}

function visitDependencies(
    collector: ResourceGraphCollector,
    descriptor: AnyResourceDefinition,
    path: readonly string[]
): void {
    for (const [ , dependency ] of entries(descriptor.dependencies)) {
        collector.visit(dependency, [ ...path, dependency.name ]);
    }
}

function createResourceGraphCollector(): ResourceGraphCollector {
    const descriptorsByName = new Map<string, AnyResourceDefinition>();
    const resourceGraph: TestBodyResourceSummary[] = [];
    const recorded = new Set<AnyResourceDefinition>();
    const traversal = new Set<AnyResourceDefinition>();
    const collector: ResourceGraphCollector = {
        resourceGraph() {
            return resourceGraph;
        },
        visit(resource, path) {
            const descriptor = ensureResource(resource, 'resource attachment');

            assertResourceCanBeRecorded(descriptorsByName, traversal, descriptor, path);
            descriptorsByName.set(descriptor.name, descriptor);

            if (recorded.has(descriptor)) {
                return;
            }

            traversal.add(descriptor);
            visitDependencies(collector, descriptor, path);
            traversal.delete(descriptor);
            recorded.add(descriptor);
            resourceGraph.push(resourceSummary(descriptor));
        }
    };

    return collector;
}

function resourceAttachmentSummary(entry: ResourceEntry): TestBodyDirectResourceAttachmentSummary {
    return {
        key: entry.key,
        resourceName: entry.resource.name
    };
}

function buildAttachments(
    directResources: readonly ResourceEntry[],
    runtimeGraphs: readonly RuntimeGraph[]
): TestBodyResourceAttachments {
    const graphCollector = createResourceGraphCollector();

    for (const entry of directResources) {
        graphCollector.visit(entry.resource, [ entry.resource.name ]);
    }

    for (const runtimeGraph of runtimeGraphs) {
        for (const [ , resource ] of entries(runtimeGraph.resources)) {
            graphCollector.visit(resource, [ resource.name ]);
        }
    }

    return {
        directResources: directResources.map(resourceAttachmentSummary),
        resourceGraph: graphCollector.resourceGraph(),
        runtimeGraphs: runtimeGraphs.map(function runtimeSummary(runtimeGraph): TestBodyRuntimeSummary {
            return {
                dimensions: runtimeGraph.dimensions,
                name: runtimeGraph.name,
                requirements: runtimeGraph.requirements.map(requirementSummary),
                resources: entries(runtimeGraph.resources).map(function runtimeResourceSummary([ key, resource ]) {
                    return {
                        key,
                        resourceName: resource.name
                    };
                })
            };
        })
    };
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

function freshDisposalSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

function lifecycleError(message: string, cause: unknown): CaseRunnerError {
    const runnerCause = cause instanceof ResourceLifecycleError && cause.cause !== undefined
        ? cause.cause
        : cause;

    return new CaseRunnerError(message, {
        cause: runnerCause,
        subtype: 'fixture'
    });
}

function isResourceScopeInput(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRuntimeTestScope<
    Graph extends RuntimeGraph,
    Scope extends TestScope
>(value: unknown, runtimeGraph: Graph): value is RuntimeTestScope<Graph, Scope> {
    if (!isResourceScopeInput(value)) {
        return false;
    }

    const runtimes: unknown = Object.hasOwn(value, 'runtimes') ? Reflect.get(value, 'runtimes') : {};

    return isResourceScopeInput(runtimes) &&
        Reflect.get(runtimes, runtimeGraph.name) !== undefined;
}

function isSingleResourceMap<const Resource extends AnyResourceDefinition>(
    value: unknown,
    resource: Resource
): value is Record<Resource['name'], Resource> {
    return isResourceScopeInput(value) &&
        Reflect.get(value, resource.name) === resource;
}

function composeResourceContext<
    Resources extends ResourceMap,
    Scope extends TestScope
>(
    scope: Scope,
    handles: ResourceScopeContext<Resources>
): ResourceTestScope<Resources, Scope> {
    const resources: unknown = Object.hasOwn(scope, 'resources') ? Reflect.get(scope, 'resources') : {};

    if (!isResourceScopeInput(resources)) {
        throw lifecycleError('Resource scope composition failed.', resources);
    }

    for (const key of Object.keys(handles)) {
        if (Object.hasOwn(resources, key)) {
            throw lifecycleError(`Resource scope "${key}" already exists.`, handles);
        }
    }

    return Object.freeze({
        ...scope,
        resources: Object.freeze({
            ...resources,
            ...handles
        })
    });
}

function composeRuntimeScope<
    Graph extends RuntimeGraph,
    Scope extends TestScope
>(
    scope: Scope,
    runtimeGraph: Graph,
    handles: RuntimeContext<Graph>
): RuntimeTestScope<Graph, Scope> {
    const runtimes: unknown = Object.hasOwn(scope, 'runtimes') ? Reflect.get(scope, 'runtimes') : {};

    if (!isResourceScopeInput(runtimes)) {
        throw lifecycleError('Runtime scope composition failed.', runtimes);
    }

    if (Object.hasOwn(runtimes, runtimeGraph.name)) {
        throw lifecycleError(`Runtime scope "${runtimeGraph.name}" already exists.`, handles);
    }

    const composed = Object.freeze({
        ...scope,
        runtimes: Object.freeze({
            ...runtimes,
            [runtimeGraph.name]: handles
        })
    });

    if (isRuntimeTestScope<Graph, Scope>(composed, runtimeGraph)) {
        return composed;
    }

    throw lifecycleError('Runtime scope composition failed.', handles);
}

function singleResourceMap<const Resource extends AnyResourceDefinition>(
    resource: Resource
): Record<Resource['name'], Resource> {
    const resources = Object.freeze({
        [resource.name]: resource
    });

    if (isSingleResourceMap(resources, resource)) {
        return resources;
    }

    throw lifecycleError('Resource map composition failed.', resource);
}

async function disposeRuntimeGraph<Graph extends RuntimeGraph>(
    session: RuntimeSession<Graph>
): Promise<void> {
    try {
        await session.disposeOnce({ signal: freshDisposalSignal() });
    } catch (error: unknown) {
        throw lifecycleError('Runtime resource disposal failed.', error);
    }
}

async function disposeResourceMap<Resources extends ResourceMap>(
    session: ResourceSession<Resources>
): Promise<void> {
    try {
        await session.disposeOnce({ signal: freshDisposalSignal() });
    } catch (error: unknown) {
        throw lifecycleError('Resource disposal failed.', error);
    }
}

async function acquireRuntime<Graph extends RuntimeGraph>(
    runtime: Graph,
    signal: AbortSignal
): Promise<RuntimeSession<Graph>> {
    try {
        assertPerCaseResourceGraph(runtime.resources);

        return await startRuntime({ runtime, signal });
    } catch (error: unknown) {
        throw error instanceof CaseRunnerError
            ? error
            : lifecycleError('Runtime resource acquisition failed.', error);
    }
}

async function acquireResources<Resources extends ResourceMap>(
    resources: Resources,
    signal: AbortSignal
): Promise<ResourceSession<Resources>> {
    try {
        assertPerCaseResourceGraph(resources);

        return await startResources({ resources, signal });
    } catch (error: unknown) {
        throw error instanceof CaseRunnerError
            ? error
            : lifecycleError('Resource acquisition failed.', error);
    }
}

export function withRuntime<
    Graph extends RuntimeGraph,
    Scope extends TestScope = TestScope
>(
    runtimeGraph: Graph,
    body: RuntimeTestBody<Graph, Scope>
): RuntimeWrappedTestBody<Graph, Scope> {
    ensureBody(body, 'withRuntime');
    const runtime = ensureRuntimeGraph(runtimeGraph);
    const attachments = buildAttachments([], [ runtime ]);
    const wrappedBody = async function runWithRuntime(scope: Scope): AsyncTestBodyResult {
        const session = await acquireRuntime(runtime, scope.signal);

        scope.cleanup(async function cleanupRuntimeResources() {
            await disposeRuntimeGraph(session);
        });

        return await body(composeRuntimeScope(scope, runtime, session.context));
    };

    return attachTestBodyResourceAttachments(wrappedBody, attachments);
}

export function withResource<
    const Resource extends AnyResourceDefinition,
    Scope extends TestScope = TestScope
>(
    resource: Resource,
    body: ResourceTestBody<Record<Resource['name'], Resource>, Scope>
): ResourceWrappedTestBody<Record<Resource['name'], Resource>, Scope> {
    ensureBody(body, 'withResource');
    const descriptor = ensureResource(resource, 'withResource');
    const attachments = buildAttachments([ { key: descriptor.name, resource: descriptor } ], []);
    const resources = singleResourceMap(descriptor);
    const wrappedBody = async function runWithResource(scope: Scope): AsyncTestBodyResult {
        const session = await acquireResources(resources, scope.signal);

        scope.cleanup(async function cleanupResource() {
            await disposeResourceMap(session);
        });

        return await body(composeResourceContext(scope, session.context));
    };

    return attachTestBodyResourceAttachments(wrappedBody, attachments);
}

export function withResources<
    const Resources extends ResourceMap,
    Scope extends TestScope = TestScope
>(
    resources: Resources,
    body: ResourceTestBody<Resources, Scope>
): ResourceWrappedTestBody<Resources, Scope> {
    ensureBody(body, 'withResources');
    const attachments = buildAttachments(readResources(resources), []);
    const wrappedBody = async function runWithResources(scope: Scope): AsyncTestBodyResult {
        const session = await acquireResources(resources, scope.signal);

        scope.cleanup(async function cleanupResources() {
            await disposeResourceMap(session);
        });

        return await body(composeResourceContext(scope, session.context));
    };

    return attachTestBodyResourceAttachments(wrappedBody, attachments);
}
