import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type {
    AnyResourceDefinition,
    ResourceContext,
    ResourceSession,
    RuntimeGraph,
    RuntimeGraphContext,
    RuntimeResourceMap
} from '../resources/resources.entry-point.ts';
import { type IsAssignable, isEqualTo } from '../../test-support/type-relations.ts';
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
        typeScope.assert(sameType<
            IsEqual<LifecycleMessages, {
                readonly acquisitionFailure: string;
                readonly disposalFailure: string;
            }>,
            true
        >());
        typeScope.assert(
            sameType<
                IsAssignable<
                    { readonly kind: 'resources'; readonly resources: RuntimeResourceMap; },
                    ResourceWrapperStep
                >,
                true
            >()
        );
        typeScope.assert(
            sameType<
                IsAssignable<{ readonly kind: 'runtime'; readonly runtime: RuntimeGraph; }, ResourceWrapperStep>,
                true
            >()
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
            sameType.withActual<true>(),
            isEqualTo<ResourceContext<RuntimeResourceMap>>()(resourceContextForStep(resources, resourceHandles))
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<RuntimeGraphContext<RuntimeGraph>>()(runtimeContextForStep(runtime, session))
        );
        return typeScope.assert.collect();
    }),
    test('exposes lifecycle error wrapping', function (typeScope) {
        typeScope.assert(acceptsCall, () => resourceWrapperLifecycleErrorUnderTest('Failed.', resource));
        typeScope.assert(acceptsCall, () => resourceWrapperErrorFromUnknownUnderTest('Failed.', resource));
        return typeScope.assert.collect();
    })
]);
