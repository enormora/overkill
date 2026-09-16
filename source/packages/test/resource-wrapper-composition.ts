import {
    attachTestBodyResourceAttachments,
    hasTestBodyResourceAttachments,
    type AssertionResult,
    type ResourceAttachedTestBody,
    type TestBody,
    type TestBodyDirectResourceAttachmentSummary,
    type TestBodyExecutionRequirementSummary,
    type TestBodyResourceAttachments,
    type TestBodyResourceSummary,
    type TestBodyRuntimeSummary,
    type TestScope
} from '../engine/engine.entry-point.ts';
import type {
    AnyResourceDefinition,
    ExecutionRequirement,
    ResourceContext,
    ResourceMap,
    RuntimeContext,
    RuntimeGraph,
    RuntimeScopeContext
} from '../resources/resources.entry-point.ts';
import {
    resourceContextForStep,
    runtimeContextForStep,
    type ComposedResourceSession,
    type LifecycleMessages
} from '../../resources/resource-wrapper-composition-core.ts';
import {
    resourceWrapperLifecycleError
} from '../../resources/resource-wrapper-lifecycle-error.ts';
import {
    directResourceEntries,
    ensureResourceDescriptor,
    lifecycleMessages,
    resourceWrapperSteps,
    stepRuntimeGraphs,
    type ResourceEntry,
    type ResourceWrapperAction,
    type ResourceWrapperScopeStep,
    type ResourceWrapperStep
} from './resource-wrapper-data.ts';
import type {
    acquireComposedResources as acquireComposedResourcesFunction,
    disposeComposedResources as disposeComposedResourcesFunction
} from './resource-wrapper-session.ts';

type TestBodyWithScope<Scope extends TestScope> = (scope: Scope) => ReturnType<TestBody>;
type CallableTestBody = (scope: never) => unknown;
type TestBodyResult = ReturnType<TestBody>;
type AsyncTestBodyResult = Promise<Awaited<TestBodyResult>>;
type ResourceWrapperSessionModule = {
    readonly acquireComposedResources: typeof acquireComposedResourcesFunction;
    readonly disposeComposedResources: typeof disposeComposedResourcesFunction;
};
type RuntimeTestScope<
    Graph extends RuntimeGraph,
    Scope extends TestScope = TestScope
> = Scope & {
    readonly runtimes: RuntimeScopeContext<Graph>;
};

type ResourceTestScope<
    Resources extends ResourceMap,
    Scope extends TestScope = TestScope
> = Scope & {
    readonly resources: ResourceContext<Resources>;
};

const composedResourceBodyBrand = Symbol.for('@overkill-dev/test/ComposedResourceBody');

type ComposedResourceBody = TestBody & {
    readonly [composedResourceBodyBrand]: {
        readonly body: CallableTestBody;
        readonly actions: readonly ResourceWrapperAction[];
    };
};

type ResourceGraphCollector = {
    readonly resourceGraph: () => readonly TestBodyResourceSummary[];
    readonly visit: (resource: AnyResourceDefinition, path: readonly string[]) => void;
};

function isComposedResourceBody(value: unknown): value is ComposedResourceBody {
    return typeof value === 'function' && Object.hasOwn(value, composedResourceBodyBrand);
}

function ensureBody(body: unknown, wrapperName: string): asserts body is CallableTestBody {
    if (typeof body !== 'function') {
        throw new TypeError(`${wrapperName}() requires a body function.`);
    }

    if (hasTestBodyResourceAttachments(body) && !isComposedResourceBody(body)) {
        throw new TypeError(`${wrapperName}() requires first-party resource wrapper metadata for wrapped bodies.`);
    }
}

function ensureResource(resource: unknown, wrapperName: string): AnyResourceDefinition {
    return ensureResourceDescriptor(resource, `${wrapperName}() requires resource descriptors.`);
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
    runtimeGraphEntries: readonly RuntimeGraph[]
): TestBodyResourceAttachments {
    const graphCollector = createResourceGraphCollector();

    for (const entry of directResources) {
        graphCollector.visit(entry.resource, [ entry.resource.name ]);
    }

    for (const runtimeGraph of runtimeGraphEntries) {
        for (const [ , resource ] of entries(runtimeGraph.resources)) {
            graphCollector.visit(resource, [ resource.name ]);
        }
    }

    return {
        directResources: directResources.map(resourceAttachmentSummary),
        resourceGraph: graphCollector.resourceGraph(),
        runtimeGraphs: runtimeGraphEntries.map(function runtimeSummary(runtimeGraph): TestBodyRuntimeSummary {
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

function bodyComposition(body: CallableTestBody): ComposedResourceBody[typeof composedResourceBodyBrand] {
    if (isComposedResourceBody(body)) {
        return body[composedResourceBodyBrand];
    }

    return {
        actions: [],
        body
    };
}

function isPromise(value: unknown): value is Promise<AssertionResult> {
    return value instanceof Promise;
}

function isAssertionNode(value: unknown): boolean {
    return typeof value === 'object' &&
        value !== null &&
        typeof Reflect.get(value, 'check') === 'string';
}

function isAssertionResult(value: unknown): value is AssertionResult {
    return isAssertionNode(value) ||
        Array.isArray(value) && value.length > 0 && value.every(isAssertionNode);
}

function isTestBodyResult(value: unknown): value is ReturnType<TestBody> {
    return isPromise(value) || isAssertionResult(value);
}

function invokeTestBody(body: CallableTestBody, scope: TestScope): ReturnType<TestBody> {
    const result: unknown = Reflect.apply(body, undefined, [ scope ]);

    if (isTestBodyResult(result)) {
        return result;
    }

    throw new TypeError('Resource wrapper body returned an invalid assertion result.');
}

function buildStepAttachments(actions: readonly ResourceWrapperAction[]): TestBodyResourceAttachments {
    return buildAttachments(directResourceEntries(actions), stepRuntimeGraphs(actions));
}

function isResourceScopeInput(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScopeMapResult(value: unknown): value is Readonly<Record<string, unknown>> {
    return isResourceScopeInput(value) && typeof Reflect.get(value, 'then') !== 'function';
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

function isResourceTestScope<
    Resources extends ResourceMap,
    Scope extends TestScope
>(value: unknown, handles: ResourceContext<Resources>): value is ResourceTestScope<Resources, Scope> {
    if (!isResourceScopeInput(value)) {
        return false;
    }

    const resources: unknown = Object.hasOwn(value, 'resources') ? Reflect.get(value, 'resources') : {};

    return isResourceScopeInput(resources) &&
        Object.keys(handles).every(function hasResourceHandle(key) {
            return Reflect.get(resources, key) !== undefined;
        });
}

function composeResourceContext<
    Resources extends ResourceMap,
    Scope extends TestScope
>(
    scope: Scope,
    handles: ResourceContext<Resources>
): ResourceTestScope<Resources, Scope> {
    const resources: unknown = Object.hasOwn(scope, 'resources') ? Reflect.get(scope, 'resources') : {};

    if (!isResourceScopeInput(resources)) {
        throw resourceWrapperLifecycleError('Resource scope composition failed.', resources);
    }

    for (const key of Object.keys(handles)) {
        if (Object.hasOwn(resources, key)) {
            throw resourceWrapperLifecycleError(`Resource scope "${key}" already exists.`, handles);
        }
    }

    const composed = Object.freeze({
        ...scope,
        resources: Object.freeze({
            ...resources,
            ...handles
        })
    });

    if (isResourceTestScope<Resources, Scope>(composed, handles)) {
        return composed;
    }

    throw resourceWrapperLifecycleError('Resource scope composition failed.', handles);
}

function composeRuntimeScope<
    Graph extends RuntimeGraph,
    Scope extends TestScope
>(
    scope: Scope,
    runtimeGraph: Graph,
    handles: RuntimeContext<RuntimeGraph>
): RuntimeTestScope<Graph, Scope> {
    const runtimes: unknown = Object.hasOwn(scope, 'runtimes') ? Reflect.get(scope, 'runtimes') : {};

    if (!isResourceScopeInput(runtimes)) {
        throw resourceWrapperLifecycleError('Runtime scope composition failed.', runtimes);
    }

    if (Object.hasOwn(runtimes, runtimeGraph.name)) {
        throw resourceWrapperLifecycleError(`Runtime scope "${runtimeGraph.name}" already exists.`, handles);
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

    throw resourceWrapperLifecycleError('Runtime scope composition failed.', handles);
}

function composeMappedScope(
    scope: TestScope,
    step: ResourceWrapperScopeStep
): TestScope {
    const mappedScope = step.mapScope(scope);

    if (!isScopeMapResult(mappedScope)) {
        throw new TypeError(`${step.name} must return an object.`);
    }

    return step.collision === 'replace-existing'
        ? Object.freeze({
            ...scope,
            ...mappedScope
        })
        : Object.freeze({
            ...mappedScope,
            ...scope
        });
}

function composeActionScope(
    scope: TestScope,
    action: ResourceWrapperAction,
    session: ComposedResourceSession
): TestScope {
    if (action.kind === 'resources') {
        return composeResourceContext(scope, resourceContextForStep(action.resources, session.directResources));
    }

    if (action.kind === 'runtime') {
        return composeRuntimeScope(scope, action.runtime, runtimeContextForStep(action.runtime, session));
    }

    return composeMappedScope(scope, action);
}

function composeActionScopes(
    scope: TestScope,
    actions: readonly ResourceWrapperAction[],
    session: ComposedResourceSession
): TestScope {
    return actions.reduce(function composeScope(composedScope, action) {
        return composeActionScope(composedScope, action, session);
    }, scope);
}

function composeMappedOnlyScopes(
    scope: TestScope,
    actions: readonly ResourceWrapperAction[]
): TestScope {
    return actions.reduce(function composeScope(composedScope, action) {
        if (action.kind !== 'scope') {
            throw resourceWrapperLifecycleError('Resource scope composition failed.', action);
        }

        return composeMappedScope(composedScope, action);
    }, scope);
}

async function importResourceWrapperSession(): Promise<ResourceWrapperSessionModule> {
    return await import('./resource-wrapper-session.ts');
}

async function acquireCompositionSession(
    steps: readonly ResourceWrapperStep[],
    signal: AbortSignal,
    messages: LifecycleMessages
): Promise<ComposedResourceSession> {
    const sessionModule = await importResourceWrapperSession();

    return await sessionModule.acquireComposedResources(steps, signal, messages);
}

async function disposeCompositionSession(
    session: ComposedResourceSession,
    messages: LifecycleMessages
): Promise<void> {
    const sessionModule = await importResourceWrapperSession();

    await sessionModule.disposeComposedResources(session, messages);
}

function defineComposedBodyBrand(
    body: CallableTestBody,
    composition: ComposedResourceBody[typeof composedResourceBodyBrand]
): void {
    Object.defineProperty(body, composedResourceBodyBrand, {
        value: Object.freeze(composition)
    });
}

function attachResourceMetadata<Scope extends TestScope>(
    body: TestBodyWithScope<Scope>,
    actions: readonly ResourceWrapperAction[]
): ResourceAttachedTestBody<TestBodyWithScope<Scope>> {
    return attachTestBodyResourceAttachments(body, buildStepAttachments(actions));
}

function isResourceAttachedBody<Scope extends TestScope>(
    body: ResourceAttachedTestBody<TestBodyWithScope<Scope>> | TestBodyWithScope<Scope>
): body is ResourceAttachedTestBody<TestBodyWithScope<Scope>> {
    return typeof body === 'function' && hasTestBodyResourceAttachments(body);
}

export function attachComposedResourceActions<Scope extends TestScope>(
    actions: readonly ResourceWrapperAction[],
    body: CallableTestBody,
    wrapperName: string
): ResourceAttachedTestBody<TestBodyWithScope<Scope>> | TestBodyWithScope<Scope> {
    ensureBody(body, wrapperName);
    const composition = bodyComposition(body);
    const composedActions = Object.freeze([ ...actions, ...composition.actions ]);
    const steps = resourceWrapperSteps(composedActions);
    const messages = lifecycleMessages(composedActions);
    const wrappedBody = async function runWithComposedResources(scope: Scope): AsyncTestBodyResult {
        if (steps.length === 0) {
            return await invokeTestBody(composition.body, composeMappedOnlyScopes(scope, composedActions));
        }

        const session = await acquireCompositionSession(steps, scope.signal, messages);

        scope.cleanup(async function cleanupComposedResources() {
            await disposeCompositionSession(session, messages);
        });

        return await invokeTestBody(composition.body, composeActionScopes(scope, composedActions, session));
    };
    const composedBody = steps.length > 0
        ? attachResourceMetadata(wrappedBody, composedActions)
        : wrappedBody;

    defineComposedBodyBrand(composedBody, {
        actions: composedActions,
        body: composition.body
    });

    return composedBody;
}

export function attachComposedResourceBody<Scope extends TestScope>(
    step: ResourceWrapperStep,
    body: CallableTestBody,
    wrapperName: string
): ResourceAttachedTestBody<TestBodyWithScope<Scope>> {
    const bodyWithResources = attachComposedResourceActions<Scope>(
        [ step ],
        body,
        wrapperName
    );

    if (isResourceAttachedBody(bodyWithResources)) {
        return bodyWithResources;
    }

    throw new TypeError(`${wrapperName}() requires resource wrapper metadata.`);
}
