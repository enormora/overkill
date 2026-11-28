import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, sameType } from '@overkill-dev/type-test';
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

export const testNode = suite('Runner resource lifecycle events', [
    test('exposes lifecycle state coordination', function (scope) {
        scope.assert(acceptsCall, function () {
            activeManagedLifecycleUnderTest();
        });
        return scope.assert.collect();
    }),
    test('exposes wrapper session composition contracts', function (scope) {
        scope.assert(sameType<
            IsEqual<LifecycleMessages, {
                readonly acquisitionFailure: string;
                readonly disposalFailure: string;
            }>,
            true
        >());
        scope.assert(
            sameType<
                IsAssignable<
                    { readonly kind: 'resources'; readonly resources: RuntimeResourceMap; },
                    ResourceWrapperStep
                >,
                true
            >()
        );
        scope.assert(
            sameType<
                IsAssignable<{ readonly kind: 'runtime'; readonly runtime: RuntimeGraph; }, ResourceWrapperStep>,
                true
            >()
        );
        scope.assert(acceptsCall, function () {
            return directResourceEntriesUnderTest([ { kind: 'resources', resources } ]);
        });
        scope.assert(acceptsCall, function () {
            return stepRuntimeGraphsUnderTest([ { kind: 'runtime', runtime } ]);
        });
        scope.assert(acceptsCall, function () {
            return combinedResourceEntriesUnderTest([
                { kind: 'resources', resources },
                { kind: 'runtime', runtime }
            ]);
        });
        scope.assert(acceptsCall, function () {
            return resourceMapFromEntriesUnderTest([ { key: 'resource', resource } ]);
        });
        scope.assert(acceptsCall, function () {
            return composedResourceSessionUnderTest(resources, [ runtime ], resourceSession);
        });
        return scope.assert.collect();
    }),
    test('exposes scoped context projection', function (scope) {
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<ResourceContext<RuntimeResourceMap>>()(resourceContextForStep(resources, resourceHandles))
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<RuntimeGraphContext<RuntimeGraph>>()(runtimeContextForStep(runtime, session))
        );
        return scope.assert.collect();
    }),
    test('exposes lifecycle error wrapping', function (scope) {
        scope.assert(acceptsCall, function () {
            return resourceWrapperLifecycleErrorUnderTest('Failed.', resource);
        });
        scope.assert(acceptsCall, function () {
            return resourceWrapperErrorFromUnknownUnderTest('Failed.', resource);
        });
        return scope.assert.collect();
    })
]);
