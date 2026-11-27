import { suite, test } from '@overkill-dev/test';
import { acceptsCall, assignableTo, sameType } from '@overkill-dev/type-test';
import type {
    AnyResourceDefinition,
    ResourceContext,
    ResourceSession,
    RuntimeGraph,
    RuntimeGraphContext,
    RuntimeResourceMap
} from '../resources/resources.entry-point.ts';
import {
    resourceContextForStep,
    runtimeContextForStep,
    type activeManagedLifecycle,
    type combinedResourceEntries,
    type composedResourceSession,
    type directResourceEntries,
    type resourceMapFromEntries,
    type resourceWrapperErrorFromUnknown,
    type resourceWrapperLifecycleError,
    type stepRuntimeGraphs,
    type ComposedResourceSession,
    type LifecycleMessages,
    type ResourceWrapperStep
} from './resource-lifecycle.entry-point.ts';

declare const resource: AnyResourceDefinition;
declare const resourceHandles: ResourceContext<RuntimeResourceMap>;
declare const resourceSession: ResourceSession<RuntimeResourceMap>;
declare const resources: RuntimeResourceMap;
declare const runtime: RuntimeGraph;
declare const session: ComposedResourceSession;

declare const activeManagedLifecycleUnderTest: typeof activeManagedLifecycle;
declare const directResourceEntriesUnderTest: typeof directResourceEntries;
declare const stepRuntimeGraphsUnderTest: typeof stepRuntimeGraphs;
declare const combinedResourceEntriesUnderTest: typeof combinedResourceEntries;
declare const resourceMapFromEntriesUnderTest: typeof resourceMapFromEntries;
declare const composedResourceSessionUnderTest: typeof composedResourceSession;
declare const resourceWrapperLifecycleErrorUnderTest: typeof resourceWrapperLifecycleError;
declare const resourceWrapperErrorFromUnknownUnderTest: typeof resourceWrapperErrorFromUnknown;

export const testNode = suite('@overkill-dev/run/resource-lifecycle', [
    test('exposes lifecycle state coordination', function (typeScope) {
        typeScope.assert(acceptsCall, () => activeManagedLifecycleUnderTest());
        return typeScope.assert.collect();
    }),
    test('exposes wrapper session composition contracts', function (typeScope) {
        typeScope.assert(sameType<LifecycleMessages, {
            readonly acquisitionFailure: string;
            readonly disposalFailure: string;
        }>());
        typeScope.assert(
            assignableTo<{ readonly kind: 'resources'; readonly resources: RuntimeResourceMap; }, ResourceWrapperStep>()
        );
        typeScope.assert(
            assignableTo<{ readonly kind: 'runtime'; readonly runtime: RuntimeGraph; }, ResourceWrapperStep>()
        );
        typeScope.assert(acceptsCall, () => directResourceEntriesUnderTest([ { kind: 'resources', resources } ]));
        typeScope.assert(acceptsCall, () => stepRuntimeGraphsUnderTest([ { kind: 'runtime', runtime } ]));
        typeScope.assert(acceptsCall, () =>
            combinedResourceEntriesUnderTest([
                { kind: 'resources', resources },
                { kind: 'runtime', runtime }
            ]));
        typeScope.assert(acceptsCall, () => resourceMapFromEntriesUnderTest([ { key: 'resource', resource } ]));
        typeScope.assert(acceptsCall, () => composedResourceSessionUnderTest(resources, [ runtime ], resourceSession));
        return typeScope.assert.collect();
    }),
    test('exposes scoped context projection', function (typeScope) {
        typeScope.assert(
            sameType.withActual<ResourceContext<RuntimeResourceMap>>(),
            resourceContextForStep(resources, resourceHandles)
        );
        typeScope.assert(
            sameType.withActual<RuntimeGraphContext<RuntimeGraph>>(),
            runtimeContextForStep(runtime, session)
        );
        return typeScope.assert.collect();
    }),
    test('exposes lifecycle error wrapping', function (typeScope) {
        typeScope.assert(acceptsCall, () => resourceWrapperLifecycleErrorUnderTest('Failed.', resource));
        typeScope.assert(acceptsCall, () => resourceWrapperErrorFromUnknownUnderTest('Failed.', resource));
        return typeScope.assert.collect();
    })
]);
