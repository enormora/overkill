import { resourceEntries } from './resource-graph.ts';
import type {
    AnyResourceDefinition,
    ResourceContext,
    RuntimeResourceMap as ResourceMap
} from './resources.ts';
import type { ResourceSession } from './resource-session.ts';
import { resourceWrapperLifecycleError } from './resource-wrapper-lifecycle-error.ts';

function mutableDependencyContext(): Record<string, unknown> {
    return {};
}

function asyncDisposeSymbol(): symbol {
    const value = Reflect.get(Symbol, 'asyncDispose');

    if (typeof value !== 'symbol') {
        throw new TypeError('Runtime does not provide Symbol.asyncDispose.');
    }

    return value;
}

function isManagedResourceSession(session: unknown): session is ResourceSession<ResourceMap> {
    return typeof session === 'object' &&
        session !== null &&
        typeof Reflect.get(session, 'disposeOnce') === 'function' &&
        typeof Reflect.get(session, asyncDisposeSymbol()) === 'function';
}

function resourceContextFromManagedRecords(
    resources: ResourceMap,
    handles: ReadonlyMap<AnyResourceDefinition, unknown>
): ResourceContext<ResourceMap> {
    const context = mutableDependencyContext();

    for (const [ key, resource ] of resourceEntries(resources)) {
        context[key] = handles.get(resource);
    }

    return Object.freeze(context);
}

export function managedResourceSession(
    resources: ResourceMap,
    handles: ReadonlyMap<AnyResourceDefinition, unknown>
): ResourceSession<ResourceMap> {
    const session = {
        context: resourceContextFromManagedRecords(resources, handles),
        async disposeOnce() {
            return undefined;
        }
    };

    Object.defineProperty(session, asyncDisposeSymbol(), {
        value: async function disposeManagedResourceSession(): Promise<void> {
            return undefined;
        }
    });
    const frozenSession = Object.freeze(session);

    if (isManagedResourceSession(frozenSession)) {
        return frozenSession;
    }

    throw resourceWrapperLifecycleError('Resource scope composition failed.', resources);
}
