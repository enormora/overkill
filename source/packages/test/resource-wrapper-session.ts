import {
    assertPerCaseResourceGraph,
    startResources,
    type AnyResourceDefinition,
    type ResourceMap,
    type RuntimeGraph
} from '../resources/resources.entry-point.ts';
import {
    activeManagedLifecycle,
    combinedResourceEntries,
    composedResourceSession,
    directResourceEntries,
    resourceMapFromEntries,
    resourceWrapperErrorFromUnknown,
    resourceWrapperLifecycleError,
    stepRuntimeGraphs,
    type ComposedResourceSession,
    type LifecycleMessages,
    type ResourceWrapperStep
} from '../run/resource-lifecycle.entry-point.ts';

async function acquireUnmanagedComposedResources(
    steps: readonly ResourceWrapperStep[],
    signal: AbortSignal
): Promise<ComposedResourceSession> {
    const directResources = resourceMapFromEntries(directResourceEntries(steps));
    const runtimes = stepRuntimeGraphs(steps);
    const combinedResources = combinedResourceEntries(steps, null);

    assertPerCaseResourceGraph(combinedResources);
    const session = await startResources({
        resources: combinedResources,
        signal
    });

    return composedResourceSession(directResources, runtimes, session, null);
}

export async function acquireComposedResources(
    steps: readonly ResourceWrapperStep[],
    signal: AbortSignal,
    messages: LifecycleMessages
): Promise<ComposedResourceSession> {
    const managedLifecycle = activeManagedLifecycle();

    if (managedLifecycle !== null) {
        return await managedLifecycle.acquireComposedResources(steps, signal, messages);
    }

    try {
        return await acquireUnmanagedComposedResources(steps, signal);
    } catch (error: unknown) {
        throw resourceWrapperErrorFromUnknown(messages.acquisitionFailure, error);
    }
}

function freshDisposalSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

export async function disposeComposedResources(
    session: ComposedResourceSession,
    messages: LifecycleMessages
): Promise<void> {
    try {
        await session.disposeOnce({ signal: freshDisposalSignal() });
    } catch (error: unknown) {
        throw resourceWrapperLifecycleError(messages.disposalFailure, error);
    }
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
