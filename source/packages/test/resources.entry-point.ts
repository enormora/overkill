import type { TestBody, TestScope } from '../engine/engine.entry-point.ts';
import {
    composeRuntimeContext,
    type RuntimeContext,
    type RuntimeDefinition
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
    ResourceScope,
    RuntimeContext,
    RuntimeContextComposition,
    RuntimeDefinition,
    RuntimeDefinitionInput,
    RuntimeDimensions,
    RuntimeId,
    RuntimeSession,
    RuntimeSessionDisposalContext,
    StartRuntimeRequest,
    TemporaryDirectoryHandle
} from '../resources/resources.entry-point.ts';

export type RuntimeTestScope<
    Runtime extends RuntimeDefinition,
    Scope extends TestScope = TestScope
> = Scope & {
    readonly runtime: RuntimeContext<Runtime>;
};

export type RuntimeTestBody<
    Runtime extends RuntimeDefinition,
    Scope extends TestScope = TestScope
> = (scope: RuntimeTestScope<Runtime, Scope>) => ReturnType<TestBody>;

export function withRuntime<
    Runtime extends RuntimeDefinition,
    Scope extends TestScope = TestScope
>(
    runtime: Runtime,
    resourceHandles: RuntimeContext<Runtime>,
    body: RuntimeTestBody<Runtime, Scope>
): (scope: Scope) => ReturnType<TestBody> {
    if (typeof body !== 'function') {
        throw new TypeError('withRuntime() requires a body function.');
    }

    return function runWithRuntime(scope): ReturnType<TestBody> {
        return body(composeRuntimeContext(scope, runtime, resourceHandles));
    };
}
