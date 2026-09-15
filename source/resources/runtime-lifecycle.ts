import {
    isDefinedRuntime,
    type ResourceContext,
    type RuntimeContext,
    type RuntimeDefinition,
    type RuntimeResourceMap
} from './resources.ts';
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

function isRuntimeSession<Runtime extends RuntimeDefinition>(
    session: RuntimeSessionBase<Runtime>
): session is RuntimeSession<Runtime> {
    return Reflect.has(session, runtimeAsyncDisposeSymbol());
}

async function disposeRuntimeResources(
    acquisition: Awaited<ReturnType<typeof acquireResourceGraph>>,
    signal: AbortSignal
): Promise<void> {
    const failures = await disposeResources(acquisition.order, acquisition.handles, signal);

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
    const acquisition = await acquireResourceGraph({
        resources: request.runtime.resources,
        signal: request.signal
    }, runtimeResourceAcquisitionContext);
    const context = runtimeContext<Runtime['resources']>(request.runtime.resources, acquisition.context);

    return runtimeSession<Runtime>(context, acquisition);
}
