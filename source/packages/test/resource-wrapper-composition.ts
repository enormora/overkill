import {
    attachTestBodyResourceAttachments,
    CaseRunnerError,
    hasTestBodyResourceAttachments,
    type ResourceAttachedTestBody,
    type AssertionResult,
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
    ResourceLifecycleError,
    type AnyResourceDefinition,
    type ExecutionRequirement,
    type ResourceContext,
    type ResourceMap,
    type RuntimeContext,
    type RuntimeGraph,
    type RuntimeScopeContext
} from '../resources/resources.entry-point.ts';
import {
    startComposedResourceSession,
    type ComposedResourceSession
} from '../../resources/composed-resource-session.ts';

type TestBodyWithScope<Scope extends TestScope> = (scope: Scope) => ReturnType<TestBody>;
type CallableTestBody = (scope: never) => unknown;
type TestBodyResult = ReturnType<TestBody>;
type AsyncTestBodyResult = Promise<Awaited<TestBodyResult>>;
type Mutable<Value> = {
    -readonly [Key in keyof Value]: Value[Key];
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

type ResourceEntry = {
    readonly key: string;
    readonly resource: AnyResourceDefinition;
};

type ResourceWrapperResourcesStep = {
    readonly kind: 'resources';
    readonly resources: ResourceMap;
};

type ResourceWrapperRuntimeStep = {
    readonly kind: 'runtime';
    readonly runtime: RuntimeGraph;
};

type ResourceWrapperStep = ResourceWrapperResourcesStep | ResourceWrapperRuntimeStep;

const composedResourceBodyBrand = Symbol.for('@overkill-dev/test/ComposedResourceBody');

type ComposedResourceBody = TestBody & {
    readonly [composedResourceBodyBrand]: {
        readonly body: CallableTestBody;
        readonly steps: readonly ResourceWrapperStep[];
    };
};

type ResourceGraphCollector = {
    readonly resourceGraph: () => readonly TestBodyResourceSummary[];
    readonly visit: (resource: AnyResourceDefinition, path: readonly string[]) => void;
};

type LifecycleMessages = {
    readonly acquisitionFailure: string;
    readonly disposalFailure: string;
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
    if (!isDefinedResource(resource)) {
        throw new TypeError(`${wrapperName}() requires resource descriptors.`);
    }

    return resource;
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
        body,
        steps: []
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

function directResourceEntries(steps: readonly ResourceWrapperStep[]): readonly ResourceEntry[] {
    return steps.flatMap(function stepResourceEntries(step) {
        return step.kind === 'resources'
            ? entries(step.resources).map(function resourceEntry([ key, resource ]) {
                return { key, resource };
            })
            : [];
    });
}

function stepRuntimeGraphs(steps: readonly ResourceWrapperStep[]): readonly RuntimeGraph[] {
    return steps.flatMap(function stepRuntimeGraph(step) {
        return step.kind === 'runtime' ? [ step.runtime ] : [];
    });
}

function buildStepAttachments(steps: readonly ResourceWrapperStep[]): TestBodyResourceAttachments {
    return buildAttachments(directResourceEntries(steps), stepRuntimeGraphs(steps));
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

function composeResourceContext<
    Resources extends ResourceMap,
    Scope extends TestScope
>(
    scope: Scope,
    handles: ResourceContext<Resources>
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

function resourceMapFromEntries(resourceEntries: readonly ResourceEntry[]): ResourceMap {
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

function resourceContextForStep<Resources extends ResourceMap>(
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

    throw lifecycleError('Resource scope composition failed.', resources);
}

function runtimeContextForStep<Graph extends RuntimeGraph>(
    runtime: Graph,
    session: ComposedResourceSession<ResourceMap>
): RuntimeContext<Graph> {
    const context = session.runtimeContexts.get(runtime);

    if (context === undefined || !isRuntimeContext(context, runtime)) {
        throw lifecycleError('Runtime scope composition failed.', runtime);
    }

    return context;
}

function lifecycleMessages(steps: readonly ResourceWrapperStep[]): LifecycleMessages {
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

async function acquireComposedResources(
    steps: readonly ResourceWrapperStep[],
    signal: AbortSignal,
    messages: LifecycleMessages
): Promise<ComposedResourceSession<ResourceMap>> {
    try {
        return await startComposedResourceSession({
            directResources: resourceMapFromEntries(directResourceEntries(steps)),
            lifecycleMessages: messages,
            runtimes: stepRuntimeGraphs(steps),
            signal
        });
    } catch (error: unknown) {
        throw error instanceof CaseRunnerError
            ? error
            : lifecycleError(messages.acquisitionFailure, error);
    }
}

async function disposeComposedResources(
    session: ComposedResourceSession<ResourceMap>,
    messages: LifecycleMessages
): Promise<void> {
    try {
        await session.disposeOnce({ signal: freshDisposalSignal() });
    } catch (error: unknown) {
        throw lifecycleError(messages.disposalFailure, error);
    }
}

function composeStepScope(
    scope: TestScope,
    step: ResourceWrapperStep,
    session: ComposedResourceSession<ResourceMap>
): TestScope {
    return step.kind === 'resources'
        ? composeResourceContext(scope, resourceContextForStep(step.resources, session.directResources))
        : composeRuntimeScope(scope, step.runtime, runtimeContextForStep(step.runtime, session));
}

function composeStepScopes(
    scope: TestScope,
    steps: readonly ResourceWrapperStep[],
    session: ComposedResourceSession<ResourceMap>
): TestScope {
    return steps.reduce(function composeScope(composedScope, step) {
        return composeStepScope(composedScope, step, session);
    }, scope);
}

export function resourceWrapperStep(resource: AnyResourceDefinition): ResourceWrapperStep {
    return {
        kind: 'resources',
        resources: Object.freeze({ [resource.name]: resource })
    };
}

export function resourcesWrapperStep(resources: ResourceMap): ResourceWrapperStep {
    return { kind: 'resources', resources };
}

export function runtimeWrapperStep(runtime: RuntimeGraph): ResourceWrapperStep {
    return { kind: 'runtime', runtime };
}

export function attachComposedResourceBody<Scope extends TestScope>(
    step: ResourceWrapperStep,
    body: CallableTestBody,
    wrapperName: string
): ResourceAttachedTestBody<TestBodyWithScope<Scope>> {
    ensureBody(body, wrapperName);
    const composition = bodyComposition(body);
    const steps = Object.freeze([ step, ...composition.steps ]);
    const attachments = buildStepAttachments(steps);
    const messages = lifecycleMessages(steps);
    const wrappedBody = async function runWithComposedResources(scope: Scope): AsyncTestBodyResult {
        const session = await acquireComposedResources(steps, scope.signal, messages);

        scope.cleanup(async function cleanupComposedResources() {
            await disposeComposedResources(session, messages);
        });

        return await invokeTestBody(composition.body, composeStepScopes(scope, steps, session));
    };
    const attachedBody = attachTestBodyResourceAttachments(wrappedBody, attachments);

    Object.defineProperty(attachedBody, composedResourceBodyBrand, {
        value: Object.freeze({
            body: composition.body,
            steps
        })
    });

    return attachedBody;
}
