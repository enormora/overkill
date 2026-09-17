import type { TestScope } from '../engine/engine.entry-point.ts';
import type {
    RuntimeGraph,
    RuntimeGraphContext,
    RuntimeScopeContext
} from '../resources/resources.entry-point.ts';
import { resourceWrapperLifecycleError } from '../run/resource-lifecycle.entry-point.ts';

type RuntimeTestScope<
    Graph extends RuntimeGraph,
    Scope extends TestScope = TestScope
> = Scope & {
    readonly runtimes: RuntimeScopeContext<Graph>;
};

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

    return isResourceScopeInput(runtimes) && (
        runtimeGraph.kind === 'composed-runtimes'
            ? runtimeGraph.runtimes.every(function hasComposedRuntimeScope(runtime) {
                return Reflect.get(runtimes, runtime.name) !== undefined;
            })
            : Reflect.get(runtimes, runtimeGraph.name) !== undefined
    );
}

function failRuntimeScopeComposition(handles: unknown): never {
    throw resourceWrapperLifecycleError('Runtime scope composition failed.', handles);
}

export function composeRuntimeScope<
    Graph extends RuntimeGraph,
    Scope extends TestScope
>(
    scope: Scope,
    runtimeGraph: Graph,
    handles: RuntimeGraphContext<Graph>
): RuntimeTestScope<Graph, Scope> {
    const runtimes: unknown = Object.hasOwn(scope, 'runtimes') ? Reflect.get(scope, 'runtimes') : {};

    if (!isResourceScopeInput(runtimes)) {
        throw resourceWrapperLifecycleError('Runtime scope composition failed.', runtimes);
    }

    const newRuntimeScopes = runtimeGraph.kind === 'composed-runtimes'
        ? handles
        : { [runtimeGraph.name]: handles };
    const duplicateRuntimeName = Object.keys(newRuntimeScopes).find(function runtimeNameExists(runtimeName) {
        return Object.hasOwn(runtimes, runtimeName);
    });

    if (duplicateRuntimeName !== undefined) {
        throw resourceWrapperLifecycleError(`Runtime scope "${duplicateRuntimeName}" already exists.`, handles);
    }

    const composed = Object.freeze({
        ...scope,
        runtimes: Object.freeze({
            ...runtimes,
            ...newRuntimeScopes
        })
    });

    return isRuntimeTestScope<Graph, Scope>(composed, runtimeGraph)
        ? composed
        : failRuntimeScopeComposition(handles);
}
