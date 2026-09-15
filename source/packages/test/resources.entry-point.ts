import {
    attachTestBodyResourceAttachments,
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
    type AnyResourceDefinition,
    type ExecutionRequirement,
    type ResourceMap,
    type RuntimeGraph
} from '../resources/resources.entry-point.ts';

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

export function withRuntime<
    Graph extends RuntimeGraph,
    Scope extends TestScope = TestScope
>(
    runtimeGraph: Graph,
    body: TestBodyWithScope<Scope>
): RuntimeWrappedTestBody<Graph, Scope> {
    ensureBody(body, 'withRuntime');
    const attachments = buildAttachments([], [ ensureRuntimeGraph(runtimeGraph) ]);

    return attachTestBodyResourceAttachments(body, attachments);
}

export function withResource<
    const Resource extends AnyResourceDefinition,
    Scope extends TestScope = TestScope
>(
    resource: Resource,
    body: TestBodyWithScope<Scope>
): ResourceWrappedTestBody<Record<Resource['name'], Resource>, Scope> {
    ensureBody(body, 'withResource');
    const descriptor = ensureResource(resource, 'withResource');
    const attachments = buildAttachments([ { key: descriptor.name, resource: descriptor } ], []);

    return attachTestBodyResourceAttachments(body, attachments);
}

export function withResources<
    const Resources extends ResourceMap,
    Scope extends TestScope = TestScope
>(
    resources: Resources,
    body: TestBodyWithScope<Scope>
): ResourceWrappedTestBody<Resources, Scope> {
    ensureBody(body, 'withResources');
    const attachments = buildAttachments(readResources(resources), []);

    return attachTestBodyResourceAttachments(body, attachments);
}
