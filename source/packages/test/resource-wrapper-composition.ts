import { withRunnerInfrastructure } from '../../execution-ownership.ts';
import { attachmentsForProducer } from '../resources/attachment-context.entry-point.ts';
import {
    isBodyReference,
    mapBodyReference,
    type BodyImplementation,
    type BodyReference,
    type RuntimeAttachments,
    forwardTestBodyFamily,
    attachTestBodyFamily,
    type TestBodyFamilyAttachment,
    attachTestBodyResourceAttachments,
    attachTestBodyWorkloadResolver,
    hasTestBodyResourceAttachments,
    type AssertionResult,
    type ResourceAttachedTestBody,
    type TestBody,
    type TestScope
} from '../engine/engine.entry-point.ts';
import type {
    ResourceContext,
    ResourceMap
} from '../resources/resources.entry-point.ts';
import {
    resourceContextForStep,
    resourceWrapperLifecycleError,
    runtimeContextForStep,
    type ComposedResourceSession,
    type LifecycleMessages
} from '../run/resource-lifecycle.entry-point.ts';
import { buildStepAttachments } from './resource-wrapper-metadata.ts';
import { attachResourceImplementations } from './resource-wrapper-implementations.ts';
import {
    bindResourceWrapperActions,
    lifecycleMessages,
    resourceWrapperSteps,
    type ResourceLifecycleScope,
    type TestBodyWithScope,
    type CallableTestBody,
    type ResourceWrapperAction,
    type ResourceWrapperScopeStep,
    type ResourceWrapperStep
} from './resource-wrapper-data.ts';
import { composeRuntimeScope } from './resource-wrapper-runtime-scope.ts';

type ResourceTestScope<
    Resources extends ResourceMap,
    Scope extends ResourceLifecycleScope = TestScope
> = Scope & {
    readonly attachments: RuntimeAttachments;
    readonly resources: ResourceContext<Resources>;
};

const composedResourceBodyBrand = Symbol.for('@overkill-dev/test/ComposedResourceBody');

type BodyComposition<Body> = { readonly body: Body; readonly actions: readonly ResourceWrapperAction[]; };
type ComposedResourceBody<Body> = Body & {
    readonly [composedResourceBodyBrand]: BodyComposition<Body>;
};

function isComposedResourceBody<Body>(value: Body): value is ComposedResourceBody<Body> {
    return (typeof value === 'function' || isBodyReference(value)) && Object.hasOwn(value, composedResourceBodyBrand);
}

function ensureBody(body: CallableTestBody, wrapperName: string): CallableTestBody {
    if (typeof body !== 'function') {
        throw new TypeError(`${wrapperName}() requires a body function.`);
    }

    if (hasTestBodyResourceAttachments(body) && !isComposedResourceBody(body)) {
        throw new TypeError(`${wrapperName}() requires first-party resource wrapper metadata for wrapped bodies.`);
    }
    return body;
}

function bodyComposition<Body>(body: Body): BodyComposition<Body> {
    if (isComposedResourceBody(body)) {
        return body[composedResourceBodyBrand];
    }

    return {
        actions: [],
        body
    };
}

function invokeTestBody(body: CallableTestBody, scope: ResourceLifecycleScope): unknown {
    const result: unknown = Reflect.apply(body, undefined, [ scope ]);
    return result;
}

function isResourceScopeInput(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScopeMapResult(value: unknown): value is Readonly<Record<string, unknown>> {
    return isResourceScopeInput(value) && typeof Reflect.get(value, 'then') !== 'function';
}

function isResourceTestScope<
    Resources extends ResourceMap,
    Scope extends ResourceLifecycleScope
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
    Scope extends ResourceLifecycleScope
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

function composeMappedScope(
    scope: ResourceLifecycleScope,
    step: ResourceWrapperScopeStep
): ResourceLifecycleScope {
    const mappedScope: unknown = Reflect.apply(step.mapScope, undefined, [ scope ]);

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
    scope: ResourceLifecycleScope,
    action: ResourceWrapperAction,
    session: ComposedResourceSession
): ResourceLifecycleScope {
    if (action.kind === 'resources') {
        return composeResourceContext(scope, resourceContextForStep(action.resources, session.directResources));
    }

    if (action.kind === 'runtime') {
        return composeRuntimeScope(scope, action.runtime, runtimeContextForStep(action.runtime, session));
    }

    return composeMappedScope(scope, action);
}

function composeActionScopes(
    scope: ResourceLifecycleScope,
    actions: readonly ResourceWrapperAction[],
    session: ComposedResourceSession
): ResourceLifecycleScope {
    return actions.reduce(function composeScope(composedScope, action) {
        return composeActionScope(composedScope, action, session);
    }, scope);
}

function composeMappedOnlyScopes(
    scope: ResourceLifecycleScope,
    actions: readonly ResourceWrapperAction[]
): ResourceLifecycleScope {
    return actions.reduce(function composeScope(composedScope, action) {
        if (action.kind !== 'scope') {
            throw resourceWrapperLifecycleError('Resource scope composition failed.', action);
        }

        return composeMappedScope(composedScope, action);
    }, scope);
}

async function acquireCompositionSession(
    steps: readonly ResourceWrapperStep[],
    signal: AbortSignal,
    messages: LifecycleMessages
): Promise<ComposedResourceSession> {
    const sessionModule = await withRunnerInfrastructure(async function loadSession() {
        return await import('./resource-wrapper-session.ts');
    });

    return await sessionModule.acquireComposedResources(steps, signal, messages);
}

async function disposeCompositionSession(
    session: ComposedResourceSession,
    messages: LifecycleMessages
): Promise<void> {
    const sessionModule = await withRunnerInfrastructure(async function loadSession() {
        return await import('./resource-wrapper-session.ts');
    });

    await sessionModule.disposeComposedResources(session, messages);
}

function defineComposedBodyBrand<Body>(
    body: Body,
    composition: BodyComposition<Body>
): void {
    Object.defineProperty(body, composedResourceBodyBrand, {
        value: Object.freeze(composition),
        enumerable: true
    });
}

function attachResourceMetadata<Scope extends ResourceLifecycleScope, Result>(
    body: TestBodyWithScope<Scope, Result>,
    actions: readonly ResourceWrapperAction[]
): ResourceAttachedTestBody<TestBodyWithScope<Scope, Result>> {
    return attachTestBodyResourceAttachments(
        attachResourceImplementations(body, actions),
        buildStepAttachments(actions)
    );
}

function isResourceAttachedBody<Scope extends ResourceLifecycleScope, Result>(
    body: ResourceAttachedTestBody<TestBodyWithScope<Scope, Result>> | TestBodyWithScope<Scope, Result>
): body is ResourceAttachedTestBody<TestBodyWithScope<Scope, Result>> {
    return typeof body === 'function' && hasTestBodyResourceAttachments(body);
}

type CompositionLifecycle = { readonly steps: readonly ResourceWrapperStep[]; readonly messages: LifecycleMessages; };
function resourceExecution(
    composition: BodyComposition<CallableTestBody>,
    composedActions: readonly ResourceWrapperAction[],
    lifecycle: CompositionLifecycle
): TestBodyWithScope<ResourceLifecycleScope, Promise<unknown>> {
    const body: TestBodyWithScope<ResourceLifecycleScope, Promise<unknown>> = async function runWithComposedResources(
        scope
    ) {
        if (lifecycle.steps.length === 0) {
            return await invokeTestBody(composition.body, composeMappedOnlyScopes(scope, composedActions));
        }

        const session = await acquireCompositionSession(lifecycle.steps, scope.signal, lifecycle.messages);
        const attachmentScope = Object.freeze({
            ...scope,
            attachments: attachmentsForProducer({ kind: 'case' })
        });

        scope.cleanup(async function cleanupComposedResources() {
            await disposeCompositionSession(session, lifecycle.messages);
        });

        return await invokeTestBody(composition.body, composeActionScopes(attachmentScope, composedActions, session));
    };
    return lifecycle.steps.length > 0 ? attachResourceMetadata(body, composedActions) : body;
}

type ReferenceComposition = {
    readonly bound: (
        actions: readonly ResourceWrapperAction[],
        body: CallableTestBody
    ) => TestBodyWithScope<ResourceLifecycleScope, Promise<unknown>>;
    readonly reference: (
        actions: readonly ResourceWrapperAction[],
        body: BodyReference<never, unknown>
    ) => BodyReference<ResourceLifecycleScope, Promise<unknown>>;
};
function attachReferencedResourceActions(
    actions: readonly ResourceWrapperAction[],
    body: BodyReference<never, unknown>,
    compositionFactory: ReferenceComposition
): BodyReference<ResourceLifecycleScope, Promise<unknown>> {
    const composition = bodyComposition(body);
    const combined = [ ...actions, ...composition.actions ];
    const mapped = mapBodyReference(composition.body, function composeResolved(resolved) {
        return compositionFactory.bound(combined, resolved);
    });
    const referenced = attachResourceImplementations(mapped, combined);
    const attached = resourceWrapperSteps(combined).length === 0
        ? referenced
        : attachTestBodyResourceAttachments(referenced, buildStepAttachments(combined));
    attachTestBodyWorkloadResolver(attached, function bindWorkload(workload) {
        return compositionFactory.reference(bindResourceWrapperActions(combined, workload), composition.body);
    });
    defineComposedBodyBrand<BodyReference<never, unknown>>(attached, { actions: combined, body: composition.body });
    return attached;
}

export function attachComposedResourceActions<Scope extends ResourceLifecycleScope, Result = ReturnType<TestBody>>(
    actions: readonly ResourceWrapperAction[],
    body: CallableTestBody,
    wrapperName: string
): TestBodyWithScope<Scope, Promise<Awaited<Result>>>;
export function attachComposedResourceActions<Scope extends ResourceLifecycleScope, Result = ReturnType<TestBody>>(
    actions: readonly ResourceWrapperAction[],
    body: BodyReference<never, unknown>,
    wrapperName: string
): BodyReference<Scope, Promise<Awaited<Result>>>;
export function attachComposedResourceActions<Scope extends ResourceLifecycleScope, Result = ReturnType<TestBody>>(
    actions: readonly ResourceWrapperAction[],
    body: BodyReference<never, unknown> | CallableTestBody,
    wrapperName: string
): BodyImplementation<Scope, Promise<Awaited<Result>>>;
export function attachComposedResourceActions(
    actions: readonly ResourceWrapperAction[],
    body: BodyReference<never, unknown> | CallableTestBody,
    wrapperName: string
): BodyImplementation<ResourceLifecycleScope, Promise<unknown>> {
    if (isBodyReference(body)) {
        return attachReferencedResourceActions(actions, body, {
            bound(selected, resolved) {
                return attachComposedResourceActions<ResourceLifecycleScope, unknown>(selected, resolved, wrapperName);
            },
            reference(selected, source) {
                return attachComposedResourceActions<ResourceLifecycleScope, unknown>(selected, source, wrapperName);
            }
        });
    }
    const composition = bodyComposition(ensureBody(body, wrapperName));
    const composedActions = Object.freeze([ ...actions, ...composition.actions ]);
    const lifecycle = { steps: resourceWrapperSteps(composedActions), messages: lifecycleMessages(composedActions) };
    const composedBody = resourceExecution(composition, composedActions, lifecycle);

    if (lifecycle.steps.length > 0) {
        attachTestBodyWorkloadResolver(composedBody, function resolveWorkload(workload) {
            const boundActions = bindResourceWrapperActions(composedActions, workload);
            return forwardTestBodyFamily(
                composedBody,
                attachComposedResourceActions<ResourceLifecycleScope, unknown>(
                    boundActions,
                    composition.body,
                    wrapperName
                )
            );
        });
    }

    defineComposedBodyBrand<CallableTestBody>(composedBody, {
        actions: composedActions,
        body: composition.body
    });

    return forwardTestBodyFamily(body, composedBody);
}

export function attachComposedResourceBody<Scope extends ResourceLifecycleScope, Result = ReturnType<TestBody>>(
    step: ResourceWrapperStep,
    body: CallableTestBody,
    wrapperName: string
): ResourceAttachedTestBody<TestBodyWithScope<Scope, Promise<Awaited<Result>>>>;
export function attachComposedResourceBody<Scope extends ResourceLifecycleScope, Result = ReturnType<TestBody>>(
    step: ResourceWrapperStep,
    body: BodyReference<never, unknown>,
    wrapperName: string
): ResourceAttachedTestBody<BodyReference<Scope, Promise<Awaited<Result>>>>;
export function attachComposedResourceBody<Scope extends ResourceLifecycleScope, Result = ReturnType<TestBody>>(
    step: ResourceWrapperStep,
    body: BodyReference<never, unknown> | CallableTestBody,
    wrapperName: string
): ResourceAttachedTestBody<
    BodyReference<Scope, Promise<Awaited<Result>>> | TestBodyWithScope<Scope, Promise<Awaited<Result>>>
>;
export function attachComposedResourceBody(
    step: ResourceWrapperStep,
    body: BodyReference<never, unknown> | CallableTestBody,
    wrapperName: string
): ResourceAttachedTestBody<BodyImplementation<ResourceLifecycleScope, Promise<unknown>>> {
    const bodyWithResources = attachComposedResourceActions<ResourceLifecycleScope, unknown>(
        [ step ],
        body,
        wrapperName
    );

    if (isBodyReference(bodyWithResources) && hasTestBodyResourceAttachments(bodyWithResources)) {
        return bodyWithResources;
    }
    if (!isBodyReference(bodyWithResources) && isResourceAttachedBody(bodyWithResources)) {
        return bodyWithResources;
    }

    throw new TypeError(`${wrapperName}() requires resource wrapper metadata.`);
}

export function mapComposedResourceBody(
    body: CallableTestBody,
    execute: (body: CallableTestBody, scope: ResourceLifecycleScope) => Promise<AssertionResult>,
    wrapperName: string,
    familyAttachment: TestBodyFamilyAttachment<unknown> | null
): TestBodyWithScope<ResourceLifecycleScope>;
export function mapComposedResourceBody(
    body: BodyReference<never, unknown>,
    execute: (body: CallableTestBody, scope: ResourceLifecycleScope) => Promise<AssertionResult>,
    wrapperName: string,
    familyAttachment: TestBodyFamilyAttachment<unknown> | null
): BodyReference<ResourceLifecycleScope>;
export function mapComposedResourceBody(
    body: BodyReference<never, unknown> | CallableTestBody,
    execute: (body: CallableTestBody, scope: ResourceLifecycleScope) => Promise<AssertionResult>,
    wrapperName: string,
    familyAttachment: TestBodyFamilyAttachment<unknown> | null
): BodyImplementation<ResourceLifecycleScope, ReturnType<TestBody>>;
export function mapComposedResourceBody(
    body: BodyReference<never, unknown> | CallableTestBody,
    execute: (body: CallableTestBody, scope: ResourceLifecycleScope) => Promise<AssertionResult>,
    wrapperName: string,
    familyAttachment: TestBodyFamilyAttachment<unknown> | null
): BodyImplementation<ResourceLifecycleScope, ReturnType<TestBody>> {
    if (isBodyReference(body)) {
        const mapped = mapBodyReference(body, function mapBound(source) {
            return mapComposedResourceBody(source, execute, wrapperName, null);
        });
        return familyAttachment === null ? mapped : attachTestBodyFamily(mapped, familyAttachment);
    }
    const composition = bodyComposition(body);
    const envelope = attachComposedResourceActions(
        composition.actions,
        async function runEnvelope(scope: ResourceLifecycleScope) {
            return execute(composition.body, scope);
        },
        wrapperName
    );
    return familyAttachment === null ? envelope : attachTestBodyFamily(envelope, familyAttachment);
}
