import {
    isDefinedRuntime,
    type AnyResourceDefinition,
    type ResourceContext,
    type RuntimeContext,
    type RuntimeDefinition,
    type RuntimeResourceMap
} from './resources.ts';
import { resolvedRuntimeScenarioOwners } from './runtime-definition.ts';
import {
    bindResourceScenarios,
    type ResolvedResourceScenarioBindings
} from './resource-scenario-binding.ts';
import { defaultScenarioBindings } from './resource-scenario.ts';
import {
    resourceLifecycleError
} from './resource-lifecycle-error.ts';

import {
    acquireResourceGraph,
    disposeResources,
    runtimeAsyncDisposeSymbol
} from './resource-session.ts';

type RuntimeSessionBase<Runtime extends RuntimeDefinition> = {
    readonly context: RuntimeContext<Runtime>;
    readonly disposeOnce: (context: RuntimeSessionDisposalContext) => Promise<void>;
};
const runtimeResourceAcquisitionContext = {
    acquisitionFailureMessage: 'Runtime resource acquisition failed.',
    fallbackResourceName: 'runtime'
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

function assertRuntimeDefinition(runtime: RuntimeDefinition): void {
    if (isDefinedRuntime(runtime)) {
        return;
    }

    throw resourceLifecycleError('Runtime descriptor is invalid.', [
        { cause: runtime, phase: 'graph', resourceName: 'runtime' }
    ], runtime);
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
    handles: ResourceContext<Resources>
): RuntimeContext<RuntimeDefinition<string, Record<string, string>, Resources>> {
    const context: Record<string, unknown> = {};

    for (const key of Object.keys(resources)) {
        context[key] = Reflect.get(handles, key);
    }

    const frozenContext = Object.freeze(context);

    if (isRuntimeContext(frozenContext, resources)) {
        return frozenContext;
    }

    throw resourceLifecycleError('Runtime resource context is incomplete.', [
        { cause: resources, phase: 'graph', resourceName: 'runtime' }
    ], resources);
}

function internalDisposalSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

function scenarioBindingsByResource(
    runtime: RuntimeDefinition
): ReadonlyMap<AnyResourceDefinition, ResolvedResourceScenarioBindings> {
    const bindingsByResource = new Map<AnyResourceDefinition, Record<string, string>>();

    for (const [ name, owner ] of resolvedRuntimeScenarioOwners(runtime)) {
        const bindings = bindingsByResource.get(owner.resource) ?? {};

        bindings[name] = owner.value;
        bindingsByResource.set(owner.resource, bindings);
    }

    return bindingsByResource;
}

function boundRuntimeResources(runtime: RuntimeDefinition): RuntimeResourceMap {
    const scenarioOwners = resolvedRuntimeScenarioOwners(runtime);

    if (scenarioOwners.size === 0) {
        return runtime.resources;
    }

    const bindingsByResource = scenarioBindingsByResource(runtime);
    const boundResources = new Map<AnyResourceDefinition, typeof runtime.resources[string]>();

    function bindResource(resource: typeof runtime.resources[string]): typeof runtime.resources[string] {
        const existing = boundResources.get(resource);

        if (existing !== undefined) {
            return existing;
        }

        const dependencies = Object.freeze(Object.fromEntries(
            Object.entries(resource.dependencies).map(function bindDependency([ key, dependency ]) {
                return [ key, bindResource(dependency) ];
            })
        ));
        const bindings: ResolvedResourceScenarioBindings = Object.freeze(
            bindingsByResource.get(resource) ?? defaultScenarioBindings(resource.scenarios)
        );
        const bound = bindResourceScenarios(Object.freeze({ ...resource, dependencies }), bindings);

        boundResources.set(resource, bound);

        return bound;
    }

    return Object.freeze(Object.fromEntries(
        Object.entries(runtime.resources).map(function bindTopLevelResource([ key, resource ]) {
            return [ key, bindResource(resource) ];
        })
    ));
}

function isRuntimeSession<Runtime extends RuntimeDefinition>(
    session: RuntimeSessionBase<Runtime>
): session is RuntimeSession<Runtime> {
    return Reflect.has(session, runtimeAsyncDisposeSymbol());
}

async function disposeRuntimeResources(
    acquisition: Awaited<ReturnType<typeof acquireResourceGraph>>,
    signal: AbortSignal
): Promise<void> {
    const failures = await disposeResources(
        acquisition.order,
        acquisition.ownerHandles,
        acquisition.resourceHandles,
        signal
    );

    if (failures.length > 0) {
        throw resourceLifecycleError('Runtime resource disposal failed.', failures, failures[0]?.cause);
    }
}

function runtimeSession<Runtime extends RuntimeDefinition>(
    context: RuntimeContext<Runtime>,
    acquisition: Awaited<ReturnType<typeof acquireResourceGraph>>
): RuntimeSession<Runtime> {
    let disposal: Promise<void> | null = null;
    const session = {
        context,
        async disposeOnce(disposalContext: RuntimeSessionDisposalContext): Promise<void> {
            if (disposal === null) {
                disposal = disposeRuntimeResources(acquisition, disposalContext.signal);
            }

            await disposal;
        }
    };

    Object.defineProperty(session, runtimeAsyncDisposeSymbol(), {
        value: async function disposeRuntimeWithInternalSignal(): Promise<void> {
            await session.disposeOnce({ signal: internalDisposalSignal() });
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
    assertRuntimeDefinition(request.runtime);
    const resources = boundRuntimeResources(request.runtime);
    const acquisition = await acquireResourceGraph({
        resources,
        signal: request.signal
    }, runtimeResourceAcquisitionContext);
    const context = runtimeContext<Runtime['resources']>(request.runtime.resources, acquisition.context);

    return runtimeSession<Runtime>(context, acquisition);
}
